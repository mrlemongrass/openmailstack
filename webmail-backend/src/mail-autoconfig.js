"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMozillaAutoconfigRouter = void 0;
const express_1 = require("express");
const escapeXml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const renderMozillaAutoconfig = ({ domain, mailHostname }) => {
    const safeDomain = escapeXml(domain);
    const safeMailHostname = escapeXml(mailHostname);
    return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${safeDomain}">
    <domain>${safeDomain}</domain>
    <displayName>OpenMailStack</displayName>
    <displayShortName>OpenMailStack</displayShortName>
    <incomingServer type="imap">
      <hostname>${safeMailHostname}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${safeMailHostname}</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;
};
const createMozillaAutoconfigRouter = (options) => {
    const router = (0, express_1.Router)();
    router.get([
        '/mail/config-v1.1.xml',
        '/.well-known/autoconfig/mail/config-v1.1.xml',
    ], (_req, res) => {
        res.type('application/xml').status(200).send(renderMozillaAutoconfig(options));
    });
    return router;
};
exports.createMozillaAutoconfigRouter = createMozillaAutoconfigRouter;
//# sourceMappingURL=mail-autoconfig.js.map