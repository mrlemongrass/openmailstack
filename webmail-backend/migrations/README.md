# Backend Migrations

Scheduler uses ordered, additive SQL migrations instead of runtime schema mutation.

- Apply files by numeric prefix inside a transaction where the database permits it.
- Record each applied file in `scheduler_schema_migrations`.
- Never edit an applied migration; add the next numbered migration.
- `functions/12_scheduler.sh` applies every ordered Scheduler migration only when `ENABLE_OMS_SCHEDULER=true`; disabled installations create no Scheduler tables.
- The installer records component state at `/etc/openmailstack/scheduler.enabled`. Database rollback remains part of the normal full-database safety snapshot rather than a destructive down migration.
- Never apply a migration manually to production without a current OpenMailStack safety snapshot.

After applying the migration to a disposable database, run the opt-in concurrency proof with that database's normal `OMS_DB_*` environment variables (or `OMS_DB_SOCKET`) plus:

```bash
OMS_SCHEDULER_TEST_DB=1 npm test
```

The Phase 1 lifecycle proof additionally uses `OMS_SCHEDULER_PHASE1_DB_TEST=1`. Run both opt-in tests only against an isolated disposable database.
