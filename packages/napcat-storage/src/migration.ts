import { DataSource } from "typeorm";
import { MsgData, UserInfo, GroupInfo, DbVersion } from "./entities";

export async function runMigration(config: any) {
    console.log("Starting migration...");
    const dataSource = new DataSource({
        type: config.type,
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.database,
        entities: [MsgData, UserInfo, GroupInfo, DbVersion],
        synchronize: true,
        logging: true
    });

    try {
        await dataSource.initialize();
        console.log("Migration completed successfully. Schema is up to date.");
        
        const versionRepo = dataSource.getRepository(DbVersion);
        const currentVersion = "1.0.0";
        const exists = await versionRepo.findOne({ where: { version: currentVersion } });
        if (!exists) {
            await versionRepo.save({
                version: currentVersion,
                description: "Initial schema",
                applied_at: new Date()
            });
            console.log("Recorded version 1.0.0");
        }

    } catch (error) {
        console.error("Migration failed:", error);
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}
