# OpenMailStack Future Plans

Here is the roadmap for upcoming features and enhancements to OpenMailStack.

## ✅ Recently Completed
- **RESTful API**: Integrates with billing systems (e.g., WHMCS) for automated user provisioning and domain creation.
- **Self-Service Portal**: Allows end-users to manage their own passwords, mail forwarding, and spam rules.
- **Domain Ownership Verification**: Enables normal domain administrators to safely add and verify their own mail domains.

- **Spam Quarantining**: Intercepts high-scoring spam at the MTA level, logs it to SQL, and provides an admin interface to review, release, or delete the quarantined emails.
- **Hierarchical Ban Rules**: Supports granular JSON-based spam policies (Emails, IPs, Extensions) managed globally, per-domain, or per-user, directly evaluated by Rspamd.
- **RedHat / RHEL OS Compatibility**: Natively supports RedHat 8/9, AlmaLinux, Rocky Linux, and CentOS Stream via an intelligent package management abstraction layer.

## 🛡️ Deliverability & Security
- **Outbound IP Reputation**: When paying Google, you get their pristine IPs. If a user on our stack is compromised, they can send 10,000 spam emails and blacklist our VPS IP on Spamhaus. We should eventually implement strict outbound rate limiting in Rspamd to protect the IP.

## 🎨 SOGo Webmail UX Reskin
- **Modernizing the Frontend**: SOGo's backend (C++) is a powerhouse, but its web UI is built on AngularJS (Angular 1.x) which is aging. While it functions perfectly, the UI paradigm lacks the fluid, modern React/Vue SPA feel of Gmail. A future project to build a modern frontend wrapper that simply queries SOGo's robust backend APIs would make this stack unstoppable.
