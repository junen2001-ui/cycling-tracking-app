require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  const pool = new Pool({ connectionString });
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await pool.query(schemaSql);
  console.log('Database schema initialized successfully');
  await pool.end();
}

main().catch((error) => {
  console.error('Failed to initialize database schema:', error.message);
  process.exit(1);
});
