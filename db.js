const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres', // Nome de usuário do banco de dados
  host: 'localhost', // Host do banco de dados (geralmente localhost)
  database: 'movies_series_db', // Nome do banco de dados
  password: 'password', // Senha do banco de dados
  port: 5432, // Porta do PostgreSQL (padrão 5432)
  connectionTimeoutMillis: 2500,
});

(async function checkConnection() {
  try {
    // Tentando uma consulta simples para garantir que a conexão foi estabelecida
    const res = await pool.query('SELECT NOW()');
    console.log('DB connected succesfuly', new Date(res.rows[0].now));
  } catch (err) {
    console.error('Error while connecting on DB', err.message, err.stack);
  }
})();
/*
const allData = [];

    for (const url of urls) {
      allData.push(await getImdbData(url));
    }

    return allData; */

module.exports = pool;
