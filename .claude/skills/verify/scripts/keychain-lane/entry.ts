import { execFileSync } from "node:child_process";
import { app, safeStorage } from "electron";
import { setSecretStore } from "../../../../../src/shared/secret-store";

const name = process.env.LANE_APP_NAME;
if (!name?.startsWith("lead-studio-lane-")) throw new Error("LANE_APP_NAME must start with lead-studio-lane-");
app.setName(name);

const PLAIN = `lane-plain-token-${Date.now()}`;

app.whenReady().then(async () => {
  try {
    setSecretStore({
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s) => safeStorage.encryptString(s),
      decryptString: (b) => safeStorage.decryptString(b),
      describeProtectionGap: () => null,
    });
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db, tables } = await import("../../../../../src/server/db");
    const store = await import("../../../../../src/server/secrets/store");
    migrate(db, { migrationsFolder: "drizzle" });
    db.insert(tables.secrets).values({ name: "IG_GRAPH_TOKEN", value: PLAIN, updatedAt: new Date().toISOString() }).run();
    const report = store.migrateSecretsToKeychain();
    const readBack = store.getSecret("IG_GRAPH_TOKEN");
    const dump = execFileSync("sqlite3", [process.env.CROWSNEST_DB_PATH as string, ".dump"], { encoding: "utf8" });
    const item = execFileSync("security", ["find-generic-password", "-s", `${name} Safe Storage`], { encoding: "utf8" }).split("\n").find((l) => l.includes('"svce"'));
    console.log(JSON.stringify({ report, readBackMatches: readBack === PLAIN, plaintextInDump: dump.includes(PLAIN), source: store.secretSource("IG_GRAPH_TOKEN"), keychainItem: item?.trim() ?? null }));
    app.exit(report.moved.length === 1 && readBack === PLAIN && !dump.includes(PLAIN) && item ? 0 : 1);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
