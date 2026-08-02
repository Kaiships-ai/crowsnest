ALTER TABLE `fleets` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Backfill column order from creation order so the current order is preserved.
UPDATE fleets
SET sort_order = (
  SELECT COUNT(*) FROM fleets f2 WHERE f2.created_at < fleets.created_at
);
--> statement-breakpoint
-- Collapse any channel in more than one fleet to a single membership: keep the row
-- whose fleet has the lowest sort_order, delete the rest. On this install every channel
-- is already in at most one fleet, so this is a safety step.
DELETE FROM fleet_channels
WHERE rowid NOT IN (
  SELECT fc.rowid
  FROM fleet_channels fc
  JOIN fleets f ON f.id = fc.fleet_id
  WHERE NOT EXISTS (
    SELECT 1 FROM fleet_channels fc2
    JOIN fleets f2 ON f2.id = fc2.fleet_id
    WHERE fc2.channel_id = fc.channel_id
      AND (f2.sort_order < f.sort_order OR (f2.sort_order = f.sort_order AND f2.id < f.id))
  )
);