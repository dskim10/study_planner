import { createServer } from 'vite';

// A separate origin keeps local test accounts apart from the normal app.
process.env.VITE_FIREBASE_USE_EMULATORS = 'true';
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-rocky';
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
server.printUrls();
