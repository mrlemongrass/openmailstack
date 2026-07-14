#!/usr/bin/env php
<?php

declare(strict_types=1);

const MILTER_VERSION = 6;
const MILTER_ACTIONS = 0x000001ff;
const MILTER_PROTOCOLS = 0x001fffff;
const MAX_FRAME_BYTES = 1048576;

function fail(string $message): never
{
    fwrite(STDERR, "Rspamd Milter probe failed: {$message}\n");
    exit(1);
}

function readExact($socket, int $length): string
{
    $buffer = '';
    while (strlen($buffer) < $length) {
        $chunk = fread($socket, $length - strlen($buffer));
        if ($chunk === false || $chunk === '') {
            $metadata = stream_get_meta_data($socket);
            if (($metadata['timed_out'] ?? false) === true) {
                throw new RuntimeException('timed out waiting for a Milter response');
            }
            throw new RuntimeException('Milter connection closed before a complete response');
        }
        $buffer .= $chunk;
    }
    return $buffer;
}

function writeFrame($socket, string $command, string $data = ''): void
{
    $payload = $command . $data;
    $frame = pack('N', strlen($payload)) . $payload;
    $written = 0;
    while ($written < strlen($frame)) {
        $count = fwrite($socket, substr($frame, $written));
        if ($count === false || $count === 0) {
            throw new RuntimeException('could not write the Milter request');
        }
        $written += $count;
    }
}

/** @return array{0: string, 1: string} */
function readFrame($socket): array
{
    $lengthData = readExact($socket, 4);
    $length = unpack('Nlength', $lengthData)['length'];
    if ($length < 1 || $length > MAX_FRAME_BYTES) {
        throw new RuntimeException("invalid Milter frame length {$length}");
    }
    $payload = readExact($socket, $length);
    return [$payload[0], substr($payload, 1)];
}

function expectContinue($socket, string $stage): void
{
    do {
        [$reply] = readFrame($socket);
    } while ($reply === 'p');

    if ($reply !== 'c') {
        throw new RuntimeException("unexpected reply at {$stage}: " . bin2hex($reply));
    }
}

function sendStage(
    $socket,
    string $command,
    string $data,
    string $stage,
    int $protocol,
    int $skipFlag,
    int $noReplyFlag,
): void {
    if (($protocol & $skipFlag) !== 0) {
        return;
    }
    writeFrame($socket, $command, $data);
    if (($protocol & $noReplyFlag) === 0) {
        expectContinue($socket, $stage);
    }
}

function expectEndOfMessage($socket): void
{
    $modificationReplies = ['+', '-', '2', 'b', 'e', 'h', 'i', 'm', 'q', 'l', 'p'];
    while (true) {
        [$reply] = readFrame($socket);
        if (in_array($reply, $modificationReplies, true)) {
            continue;
        }
        if ($reply === 'a' || $reply === 'c') {
            return;
        }
        throw new RuntimeException('unexpected end-of-message reply: ' . bin2hex($reply));
    }
}

$host = $argv[1] ?? '127.0.0.1';
$port = filter_var($argv[2] ?? '11332', FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1, 'max_range' => 65535],
]);
$timeout = filter_var($argv[3] ?? '12', FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 1, 'max_range' => 60],
]);

if ($host === '' || $port === false || $timeout === false) {
    fail('usage: rspamd_milter_probe.php [host] [port] [timeout-seconds]');
}

$socket = @stream_socket_client(
    "tcp://{$host}:{$port}",
    $errorNumber,
    $errorMessage,
    (float) $timeout,
    STREAM_CLIENT_CONNECT,
);
if ($socket === false) {
    fail("could not connect to {$host}:{$port}: {$errorMessage} ({$errorNumber})");
}
stream_set_timeout($socket, $timeout);

try {
    writeFrame($socket, 'O', pack('NNN', MILTER_VERSION, MILTER_ACTIONS, MILTER_PROTOCOLS));
    [$reply, $options] = readFrame($socket);
    if ($reply !== 'O' || strlen($options) !== 12) {
        throw new RuntimeException('invalid Milter option negotiation response');
    }
    $negotiated = unpack('Nversion/Nactions/Nprotocol', $options);
    if ($negotiated['version'] < 1 || $negotiated['version'] > MILTER_VERSION) {
        throw new RuntimeException('unsupported negotiated Milter version');
    }
    if (($negotiated['actions'] & ~MILTER_ACTIONS) !== 0 || ($negotiated['protocol'] & ~MILTER_PROTOCOLS) !== 0) {
        throw new RuntimeException(sprintf(
            'Milter selected capabilities the probe did not offer (actions=0x%08x, protocol=0x%08x)',
            $negotiated['actions'],
            $negotiated['protocol'],
        ));
    }
    $protocol = $negotiated['protocol'];

    sendStage(
        $socket,
        'C',
        "openmailstack-health.invalid\0" . '4' . pack('n', 0) . "127.0.0.1\0",
        'connect',
        $protocol,
        0x00000001,
        0x00001000,
    );

    sendStage($socket, 'H', "openmailstack-health.invalid\0", 'HELO', $protocol, 0x00000002, 0x00002000);

    if (($protocol & 0x00000004) === 0) {
        writeFrame(
            $socket,
            'D',
            'M'
                . "i\0OMS-RSPAMD-HEALTH\0"
                . "{mail_addr}\0healthcheck@openmailstack.invalid\0"
                . "{client_addr}\0" . "127.0.0.1\0",
        );
    }
    sendStage(
        $socket,
        'M',
        "<healthcheck@openmailstack.invalid>\0",
        'MAIL FROM',
        $protocol,
        0x00000004,
        0x00004000,
    );

    sendStage(
        $socket,
        'R',
        "<healthcheck@openmailstack.invalid>\0",
        'RCPT TO',
        $protocol,
        0x00000008,
        0x00008000,
    );

    sendStage($socket, 'T', '', 'DATA', $protocol, 0x00000200, 0x00010000);

    $headers = [
        ['From', 'healthcheck@openmailstack.invalid'],
        ['To', 'healthcheck@openmailstack.invalid'],
        ['Subject', 'OpenMailStack Rspamd Milter health probe'],
        ['Message-ID', '<rspamd-milter-health@openmailstack.invalid>'],
        ['Date', 'Tue, 14 Jul 2026 12:00:00 +0000'],
    ];
    if (($protocol & 0x00000020) === 0) {
        foreach ($headers as [$name, $value]) {
            sendStage(
                $socket,
                'L',
                $name . "\0" . $value . "\0",
                "header {$name}",
                $protocol,
                0,
                0x00000080,
            );
        }
    }

    sendStage($socket, 'N', '', 'end of headers', $protocol, 0x00000040, 0x00040000);
    sendStage(
        $socket,
        'B',
        "Functional filtering probe.\r\n",
        'body',
        $protocol,
        0x00000010,
        0x00080000,
    );
    writeFrame($socket, 'E');
    expectEndOfMessage($socket);
    writeFrame($socket, 'Q');
} catch (Throwable $error) {
    fclose($socket);
    fail($error->getMessage());
}

fclose($socket);
fwrite(STDOUT, "Rspamd Milter transaction passed\n");
