# OpenMailStack Future Plans

Here is the roadmap for upcoming features and enhancements to OpenMailStack.

## ✅ Recently Completed
- **RESTful API**: Integrates with billing systems (e.g., WHMCS) for automated user provisioning and domain creation.
- **Self-Service Portal**: Allows end-users to manage their own passwords, mail forwarding, and spam rules.
- **Domain Ownership Verification**: Enables normal domain administrators to safely add and verify their own mail domains.

- **Spam Quarantining**: Intercepts high-scoring spam at the MTA level, logs it to SQL, and provides an admin interface to review, release, or delete the quarantined emails.
- **Hierarchical Ban Rules**: Supports granular JSON-based spam policies (Emails, IPs, Extensions) managed globally, per-domain, or per-user, directly evaluated by Rspamd.

## 🐧 OS Support
- **RedHat / RHEL Variants**: Compatibility updates and package management support for RedHat, AlmaLinux, and Rocky Linux.
