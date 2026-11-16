import { shutdown } from './postmaster.ts';

const [pgCtl = '', directory = '', socket = '', uid, gid] = process.argv.slice(2);
const runAs = uid && gid ? { uid: Number(uid), gid: Number(gid) } : undefined;

// A terminal's Ctrl-C signals the whole process group, and this process must outlive its parent.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

// Nobody is left to report a failure to.
process.stdin.on('end', () => shutdown(pgCtl, directory, socket, runAs).catch(() => undefined));
process.stdin.resume();
