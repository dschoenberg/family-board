import { loadConfig } from '../server/config.ts';
const c = loadConfig();
console.log(`http://${c.server.host === '::1' ? '[::1]' : c.server.host}:${c.server.port}`);
