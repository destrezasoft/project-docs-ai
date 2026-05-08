import { Sequelize } from "sequelize";
import { registerModels } from "@/models";

let sequelize: Sequelize | null = null;

export function getSequelize(): Sequelize {
	if (!sequelize) {
		const database = process.env.DATABASE_NAME;
		const username = process.env.DATABASE_USER;
		const password = process.env.DATABASE_PASSWORD ?? "";
		const host = process.env.DATABASE_HOST ?? "127.0.0.1";
		const port = Number(process.env.DATABASE_PORT ?? "3306");

		if (!database || !username) {
			throw new Error(
				"Missing DATABASE_NAME or DATABASE_USER environment variables.",
			);
		}

		sequelize = new Sequelize(database, username, password, {
			host,
			port,
			dialect: "mysql",
			logging: false,
			define: {
				underscored: true,
				timestamps: true,
			},
		});
	}
	return sequelize;
}

export async function syncDatabase(): Promise<void> {
	const sql = getSequelize();
	registerModels(sql);
	await sql.authenticate();
	await sql.sync();
}
