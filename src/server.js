// 진입점: node src/server.js  (npm start)
import { createApp } from './app.js';

const { server, config } = createApp();
server.listen(config.port, '127.0.0.1', () => {
  console.log(`[rse] listening http://127.0.0.1:${config.port}  DB_PATH=${config.dbPath}`);
});
