
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import rimraf from 'rimraf';
import path from 'path';
import os from 'os';
import mkdirp from 'mkdirp';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const EXIT_FILE = '.exit';
const UPDATE_FILE = '.update';

async function runCommand(command: string, ...args: string[]) {
    console.log('running', command, ...args);
    const cp = child_process.spawn(command, args, {
        stdio: 'inherit'
    });
    await once(cp, 'exit');
}

async function runCommandEatError(command: string, ...args: string[]) {
    try {
        await runCommand(command, ...args);
    }
    catch (e) {
        console.warn(command, args, 'command exited with error, ignoring', e)
    }
}

async function startServer() {
    try {
        console.log('Starting scrypted main...');
        await runCommand(process.argv[0], '--expose-gc', 'node_modules/@scrypted/server/dist/scrypted-main.js');
    }
    catch (e) {
        console.error('scrypted server exited with error', e);
    }
}

export async function serveMain(install: boolean) {
    const installDir = path.join(os.homedir(), '.scrypted');
    const volume = path.join(installDir, 'volume');
    mkdirp.sync(volume);
    process.chdir(installDir);
    if (!fs.existsSync('node_modules/@scrypted/server')) {
        install = true;
        console.log('Package @scrypted/server not found. Installing.');
    }
    if (install) {
        await runCommandEatError('npm', '--prefix', installDir, 'install', '--production', '@scrypted/server@latest');
    }

    process.env.SCRYPTED_NPM_SERVE = 'true';
    process.env.SCRYPTED_VOLUME = volume;
    process.env.SCRYPTED_CAN_EXIT = 'true';
    process.env.SCRYPTED_CAN_RESTART = 'true';
    console.log('cwd', process.cwd());

    while (true) {
        rimraf.sync(EXIT_FILE);
        rimraf.sync(UPDATE_FILE);

        await startServer();

        if (fs.existsSync(EXIT_FILE)) {
            console.log('Exiting.');
            process.exit();
        }
        else if (fs.existsSync(UPDATE_FILE)) {
            console.log('Update requested. Installing.');
            await runCommandEatError('npm', '--prefix', installDir, 'install', '--production', '@scrypted/server@latest');
        }
        else {
            console.log(`Service exited. Restarting momentarily.`);
            await sleep(10000);
        }
    }
}
