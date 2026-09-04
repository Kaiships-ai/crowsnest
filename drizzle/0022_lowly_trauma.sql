-- Goal 2: cook/create studio removed. create_runs held transient cook-run history only
-- (dev-local SQLite, no backup by decision). The drop is logged at migrate time by the
-- runner below; this comment records intent for anyone reading the migration.
DROP TABLE `create_runs`;