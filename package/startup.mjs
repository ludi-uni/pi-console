// Launched by the current user's Windows Startup shortcut, never by the Pi RPC worker.
// Node is started with --env-file-if-exists=.env --import tsx and cwd=package root.
import { connect } from 'node:net';
const port = Number(process.env.PORT ?? 31717);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid pi-console startup PORT');
const occupied = await new Promise(resolve => {
  const socket = connect({host:'127.0.0.1',port});
  socket.setTimeout(1500);
  socket.once('connect',()=>{socket.destroy();resolve(true)});
  socket.once('error',()=>{socket.destroy();resolve(false)});
  socket.once('timeout',()=>{socket.destroy();resolve(true)});
});
if (occupied) process.exit(0); // Do not disturb an existing server or another owner of the port.
await import('../server/index.ts');
