import { shutdown } from './postmaster.ts';

const [pgCtl = '', directory = '', socket = ''] = process.argv.slice(2);

// A terminal's Ctrl-C signals the whole process group, and this process must outlive its parent.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

// Nobody is left to report a failure to.
process.stdin.on('end', () => shutdown(pgCtl, directory, socket).catch(() => undefined));
process.stdin.resume();
