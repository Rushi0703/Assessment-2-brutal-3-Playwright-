import { Client } from 'pg';
import { log } from '../utils/logger'

let pgClient: Client;

/**
 * Executes a SQL query on a PostgreSQL database.
 * The connection string is constructed using environment variables DB_USERNAME, DB_PASSWORD, DB_SERVER_NAME, DB_PORT, and DB_NAME.
 * Logs info messages on successful connection and query execution, and error messages on failures.
 * @param {string} queryString - The SQL query to execute.
 * @param {string} testcase_id - The test case ID for logging purposes.
 * @returns {Promise<any[]>} - A promise that resolves with the query results as an array of rows, or rejects if an error occurs.
 */
export async function executeQuery(queryString: string, testcase_id: string): Promise<any[]> {
    const dbUsername = process.env.DB_USERNAME;
    const dbPassword = process.env.DB_PASSWORD;
    const dbServerName = process.env.DB_SERVER_NAME;
    const dbPort = process.env.DB_PORT;
    const dbName = process.env.DB_NAME;

    const connectionString = `postgres://${dbUsername}:${dbPassword}@${dbServerName}:${dbPort}/${dbName}`;

    pgClient = new Client(connectionString);

    try {
        await log('INFO', '============================================================================');
        await log('INFO', `TC_ID = ${testcase_id} | Connecting to database ${dbName} on server ${dbServerName}`);
        await pgClient.connect();
        await log('INFO', `TC_ID = ${testcase_id} | Connected to database ${dbName} on server ${dbServerName}`);
        const result = await pgClient.query(queryString);
        await log('INFO', `TC_ID = ${testcase_id} | Executed query: ${queryString}`);
        await log('INFO', `TC_ID = ${testcase_id} | Query returned ${result.rows.length} rows`);
        return result.rows;
    } catch (error) {
        await log('ERROR', `TC_ID = ${testcase_id} | An error occurred while executing query: ${queryString}`);
        throw error;
    } finally {
        await pgClient.end();
        await log('INFO', `TC_ID = ${testcase_id} | Disconnected from database ${dbName}`);
        await log('INFO', '============================================================================');
    }
}
