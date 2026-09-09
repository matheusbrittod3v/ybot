import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbUrl = process.env.DATABASE_URL || 'mysql://mysql:AY6JJOKzty08XXou0pN4@209.126.81.68:3306/boty';

export async function runMigrations({ fresh = false } = {}) {
  console.log(`[Migrations] Conectando ao MySQL em: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
  const connection = await mysql.createConnection(dbUrl);

  try {
    if (fresh) {
      console.log('[Migrations] ⚠️ Executando limpeza completa de tabelas (--fresh)...');
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      const [tables] = await connection.query('SHOW TABLES');
      for (const tableObj of tables) {
        const tableName = Object.values(tableObj)[0];
        console.log(`[Migrations] Apagando tabela antiga: ${tableName}`);
        await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log('[Migrations] ✅ Banco de dados limpo com sucesso!');
    }

    // Garante que a tabela de controle de migrations exista
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const [appliedRows] = await connection.query('SELECT migration_name FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map(r => r.migration_name));

    for (const file of files) {
      if (!fresh && appliedSet.has(file)) {
        console.log(`[Migrations] Ignorando (já aplicada): ${file}`);
        continue;
      }

      console.log(`[Migrations] Executando migration: ${file}`);
      const sqlContent = fs.readFileSync(path.join(__dirname, file), 'utf-8');

      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          await connection.query(stmt);
        } catch (err) {
          if (err.code === 'ER_DUP_FIELDNAME' || err.errno === 1060) continue;
          throw err;
        }
      }

      if (!appliedSet.has(file)) {
        await connection.query('INSERT INTO schema_migrations (migration_name) VALUES (?)', [file]);
      }
      console.log(`[Migrations] ✅ Migration concluída: ${file}`);
    }

    // Garante que todas as colunas adicionais existam no schema, independentemente do histórico
    const extraColumns = [
      'ALTER TABLE settings ADD COLUMN enable_schedule_overlay TINYINT(1) DEFAULT 1',
      'ALTER TABLE settings ADD COLUMN schedule_overlay_interval INT DEFAULT 10',
      'ALTER TABLE settings ADD COLUMN schedule_overlay_duration INT DEFAULT 12',
      'ALTER TABLE queue_items ADD COLUMN last_position_seconds INT DEFAULT 0',
      'ALTER TABLE queue_items ADD COLUMN start_at_seconds INT DEFAULT 0'
    ];
    for (const stmt of extraColumns) {
      try {
        await connection.query(stmt);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.errno === 1060) continue;
      }
    }

    console.log('[Migrations] Todas as migrations foram verificadas e aplicadas com sucesso!');
  } finally {
    await connection.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isFresh = process.argv.includes('--fresh');
  runMigrations({ fresh: isFresh }).catch(err => {
    console.error('[Migrations Erro]', err.message);
    process.exit(1);
  });
}
