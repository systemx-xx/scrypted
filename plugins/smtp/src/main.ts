import { MixinProvider, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, StartStop } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import smtp, { SMTPServer } from 'smtp-server';
import { ParsedMail, simpleParser } from 'mailparser';

const { systemManager } = sdk;

class SmtpMixin extends SettingsMixinDeviceBase<Settings> {
    realDevice = systemManager.getDeviceById<OnOff & StartStop>(this.id);

    async getMixinSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Email Address',
                key: 'email',
                description: 'The inbox on the SMTP that will receive mail. The plugin SMTP server will accept any username and domain.',
                placeholder: 'front-camera-motion@example.com',
                value: this.getEmail(),
            },
            {
                title: 'On/Start Search Text',
                key: 'onText',
                description: 'Turn on or start the device when the entered text is found. Leave empty to turn on any mail.',
                value: this.storage.getItem('onText'),
            },
            {
                title: 'Off/Stop Search Text',
                key: 'offText',
                description: 'Turn off or stop the device when the entered text is found. Leave empty to turn off any text (will be ignored if On Text is also empty).',
                value: this.storage.getItem('offText'),
            },
        ]
    }

    async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
        this.storage.setItem(key, value.toString());
    }

    getEmail() {
        return this.storage.getItem('email');
    }

    async handle(parsed: ParsedMail) {
        this.console.log('handling incoming mail');
        this.console.log('mail text:', parsed.text);
        const { onText, offText } = this.storage;

        if (!onText || (parsed.text.indexOf(onText) !== -1)) {
            if (this.realDevice.interfaces.includes(ScryptedInterface.OnOff)) {
                this.console.log('SMTP turning on device.');
                this.realDevice.turnOn();
            }
            if (this.realDevice.interfaces.includes(ScryptedInterface.StartStop)) {
                this.console.log('SMTP starting device.');
                this.realDevice.start();
            }
        }

        if ((!offText && onText) || (offText && parsed.text.indexOf(offText) !== -1)) {
            if (this.realDevice.interfaces.includes(ScryptedInterface.OnOff)) {
                this.console.log('SMTP turning off device.');
                this.realDevice.turnOff();
            }
            if (this.realDevice.interfaces.includes(ScryptedInterface.StartStop)) {
                this.console.log('SMTP stopping device.');
                this.realDevice.stop();
            }
        }
    }
}

class MailPlugin extends ScryptedDeviceBase implements Settings, MixinProvider {
    createdMixins = new Map<string, SmtpMixin>();
    server: SMTPServer;

    constructor(nativeId?: string) {
        super(nativeId);

        this.createServer();

        for (const id of Object.keys(systemManager.getSystemState())) {
            const realDevice = systemManager.getDeviceById(id);
            if (realDevice.mixins?.includes(this.id))
                realDevice.probe().catch(e => {});
        }
    }

    createServer() {
        this.console.log('creating SMTP server');
        this.server?.close();
        this.server = new smtp.SMTPServer({
            allowInsecureAuth: true,
            authOptional: true,
            logger: true,

            onConnect: (session, callback) => {
                callback();
            },
            onAuth: (auth, session, callback) => {
                callback(null, {
                    user: 'scrypted',
                })
            },
            onMailFrom: (address, session, callback) => {
                callback();
            },
            onRcptTo: (address, session, callback) => {
                callback();
            },
            onData: async (stream, session, callback) => {
                try {
                    const parsed = await simpleParser(stream);
                    this.console.log('parsed mail', parsed.from, parsed.to);
                    this.handle(parsed);
                }
                catch (e) {
                    this.console.error('error parsing mail', e);
                }
                callback();
            },
        });
        this.server.on("error", e => {
            this.console.error("SMTP Error %s", e);
        });
        const port = this.getPort();
        this.server.listen(port);
        this.console.log('created SMTP server');
    }

    async handle(parsed: ParsedMail) {
        for (const addresses of parsed.to instanceof Array ? parsed.to : [parsed.to]) {
            for (const address of addresses.value) {
                const mixins = [...this.createdMixins.values()].filter(mixin => mixin.getEmail() === address.address);
                if (!mixins.length) {
                    this.console.warn('no handler for', address);
                    return;
                }
                for (const mixin of mixins) {
                    mixin.handle(parsed);
                }
            }
        }
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: "SMTP Port (No Authentication)",
                key: 'smtpPort',
                value: this.getPort().toString(),
            }
        ]
    }

    getPort() {
        return parseInt(this.storage.getItem('smtpPort')) || 25;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());

        this.server.close();
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (interfaces.includes(ScryptedInterface.OnOff) || interfaces.includes(ScryptedInterface.StartStop)) {
            return [
                ScryptedInterface.Settings,
            ];
        }
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        const ret = new SmtpMixin(mixinDevice, mixinDeviceState, {
            mixinDeviceInterfaces,
            providerNativeId: this.nativeId,
            group: "Mail",
            groupKey: "mail",
        });

        this.createdMixins.set(ret.id, ret);
        ret.onDeviceEvent(ScryptedInterface.Settings, undefined);
        return ret;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        this.createdMixins.delete(id);
    }
}

export default new MailPlugin();