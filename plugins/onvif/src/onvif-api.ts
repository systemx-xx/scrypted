import { EventEmitter, once } from 'events';
import { Destroyable } from '../../rtsp/src/rtsp';
import DigestClient from './digest-client';

const onvif = require('onvif');
const { Cam } = onvif;

export enum OnvifEvent {
    MotionStart,
    MotionStop,
    AudioStart,
    AudioStop,
}

export class OnvifCameraAPI {
    digestAuth: DigestClient;

    constructor(public cam: any, username: string, password: string) {
        this.digestAuth = new DigestClient(username, password);
    }

    listenEvents() {
        const ret = new EventEmitter();
        this.cam.on('event', (event: any) => {
            const value = event.message?.message?.data?.simpleItem?.$?.Value;
            if (event.topic?._?.indexOf('MotionAlarm') !== -1) {
                if (value === true)
                    ret.emit('event', OnvifEvent.MotionStart)
                else if (value === false)
                    ret.emit('event', OnvifEvent.MotionStop)
            }
            else if (event.topic?._?.indexOf('DetectedSound') !== -1) {
                if (value === true)
                    ret.emit('event', OnvifEvent.AudioStart)
                if (value === false)
                    ret.emit('event', OnvifEvent.AudioStop)
            }
        });
        return ret;
    }

    async getStreamUrl(): Promise<string> {
        return new Promise((resolve, reject) => this.cam.getStreamUri({ protocol: 'RTSP' }, (err: Error, uri: string) => err ? reject(err) : resolve(uri)));
    }

    async jpegSnapshot(): Promise<Buffer> {
        const url: string = (await new Promise((resolve, reject) => this.cam.getSnapshotUri((err: Error, uri: string) => err ? reject(err) : resolve(uri))) as any).uri;

        const response = await this.digestAuth.fetch(url);
        const buffer = await response.arrayBuffer();

        return Buffer.from(buffer);
    }
}

export async function connectCameraAPI(hostname: string, username: string, password: string) {
    const cam = await new Promise((resolve, reject) => {
        const cam = new Cam({
            hostname,
            username,
            password,
        }, (err: Error) => err ? reject(err) : resolve(cam)
        )
    });

    return new OnvifCameraAPI(cam, username, password);
}