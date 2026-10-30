const mysql = require('mysql2/promise');
require('dotenv').config();

// Pool de conexiones a MySQL Aiven
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 10900,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: false // Permite la conexión SSL requerida por Aiven
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Probar conexión inicial
(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ Conexión exitosa a MySQL en Aiven (SSL)');
        connection.release();
    } catch (error) {
        console.error('❌ Error conectando a Aiven MySQL:', error.message);
    }
})();

module.exports = db;