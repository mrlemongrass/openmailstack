export interface OutboundIdentityInput {
  from?: string;
  replyTo?: string;
  bcc?: string;
  alwaysBccSelf: boolean;
  selfAddress?: string;
}

export interface OutboundIdentityFields {
  from?: string;
  replyTo?: string;
  bcc?: string;
}

function containsExactAddress(addressList: string, address: string): boolean {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s<,;"])${escaped}(?=$|[\\s>,;"])`, 'i').test(addressList);
}

export function outboundIdentityFields(input: OutboundIdentityInput): OutboundIdentityFields {
  const from = input.from?.trim();
  const replyTo = input.replyTo?.trim();
  const selfAddress = input.selfAddress?.trim();
  let bcc = input.bcc?.trim() || '';

  if (input.alwaysBccSelf && selfAddress && !containsExactAddress(bcc, selfAddress)) {
    bcc = bcc ? `${bcc}, ${selfAddress}` : selfAddress;
  }

  return {
    ...(from ? { from } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(bcc ? { bcc } : {}),
  };
}
