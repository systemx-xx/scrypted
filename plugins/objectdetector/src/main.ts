import { MixinProvider, ScryptedDeviceType, ScryptedInterface, MediaObject, VideoCamera, Settings, Setting, Camera, EventListenerRegister, ObjectDetector, ObjectDetection, ScryptedDeviceBase, ScryptedDevice, ObjectDetectionResult, FaceRecognitionResult, ObjectDetectionTypes, ObjectsDetected, MotionSensor } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SettingsMixinDeviceBase } from "../../../common/src/settings-mixin";
import { randomBytes } from 'crypto';
import { DenoisedDetectionEntry, denoiseDetections } from './denoise';

export interface DetectionInput {
  jpegBuffer?: Buffer;
  input: any;
}

const DISPOSE_TIMEOUT = 10000;

const { mediaManager, systemManager, log } = sdk;

const defaultMinConfidence = 0.5;
const defaultObjectInterval = 1000;
const defaultRecognitionInterval = 1000;
const defaultDetectionDuration = 30000;

class ObjectDetectionMixin extends SettingsMixinDeviceBase<ObjectDetector> implements ObjectDetector, Settings {
  released = false;
  registerMotion: EventListenerRegister;
  detections = new Map<string, DetectionInput>();
  realDevice: ScryptedDevice & Camera & VideoCamera & ObjectDetector & MotionSensor;
  minConfidence = parseInt(this.storage.getItem('minConfidence')) || defaultMinConfidence;
  objectInterval = parseInt(this.storage.getItem('objectInterval')) || defaultObjectInterval;
  recognitionInterval = parseInt(this.storage.getItem('recognitionInterval')) || defaultRecognitionInterval;
  detectionDuration = parseInt(this.storage.getItem('detectionDuration')) || defaultDetectionDuration;
  currentDetections: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
  currentPeople: DenoisedDetectionEntry<FaceRecognitionResult>[] = [];
  objectDetection: ObjectDetection & ScryptedDevice;
  detectionId = randomBytes(8).toString('hex');
  detectionListener: EventListenerRegister;

  constructor(mixinDevice: VideoCamera & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, public objectDetectionPlugin: ObjectDetectionPlugin) {
    super(mixinDevice, mixinDeviceState, {
      providerNativeId: objectDetectionPlugin.nativeId,
      mixinDeviceInterfaces,
      group: "Object Detection Settings",
      groupKey: "objectdetectionplugin",
    });

    this.realDevice = systemManager.getDeviceById<Camera & VideoCamera & ObjectDetector & MotionSensor>(this.id);

    this.bindObjectDetection();
    this.register();
  }

  bindObjectDetection() {
    this.detectionListener?.removeListener();
    this.detectionListener = undefined;
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });
    this.objectDetection = undefined;

    this.objectDetection = systemManager.getDeviceById<ObjectDetection>(this.storage.getItem('objectDetection'));
    if (!this.objectDetection) {
      const message = 'Select an object detecton device for ' + this.realDevice.name
      log.a(message);
      this.console.error(message);
      return;
    }

    this.objectDetection.listen({
      event: ScryptedInterface.ObjectDetection,
      watch: false,
    }, (eventSource, eventDetails, eventData: ObjectsDetected) => {
      if (eventData?.detectionId !== this.detectionId)
        return;
      this.objectsDetected(eventData)
    })
  }

  async register() {
    this.registerMotion = this.realDevice.listen(ScryptedInterface.MotionSensor, async () => {
      if (!this.realDevice.motionDetected)
        return;
      this.objectDetection?.detectObjects(await this.realDevice.getVideoStream(), {
        detectionId: this.detectionId,
        duration: defaultDetectionDuration,
      });
    });
  }

  reportObjectDetections(detectionInput?: DetectionInput) {
    const detectionId = Math.random().toString();
    const detection: ObjectsDetected = {
      timestamp: Date.now(),
      detectionId: detectionInput ? detectionId : undefined,
      inputDimensions: detectionInput
        ? [detectionInput?.input.shape[1], detectionInput?.input.shape[0]]
        : undefined,
      detections: this.currentDetections.map(d => d.detection),
    }

    if (detectionInput)
      this.setDetection(detectionId, detectionInput);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async extendedObjectDetect() {
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
      duration: 60000,
    });
  }

  async objectsDetected(detectionResult: ObjectsDetected) {
    if (!detectionResult?.detections) {
      return;
    }

    // this.console.log('detected', Date.now() - detectionResult.timestamp)

    const found: DenoisedDetectionEntry<ObjectDetectionResult>[] = [];
    denoiseDetections<ObjectDetectionResult>(this.currentDetections, detectionResult.detections.map(detection => ({
      name: detection.className,
      detection,
    })), {
      added: d => found.push(d),
      removed: d => {
        this.console.log('no longer detected', d.name)
        this.reportObjectDetections()
      }
    });
    if (found.length) {
      this.console.log('detected', found.map(d => d.detection.className).join(', '));
      this.extendedObjectDetect();
    }

    this.reportObjectDetections(undefined);
  }

  reportPeopleDetections(faces?: ObjectDetectionResult[], detectionInput?: DetectionInput) {
    const detectionId = Math.random().toString();
    const detection: ObjectsDetected = {
      timestamp: Date.now(),
      detectionId: detectionInput ? detectionId : undefined,
      inputDimensions: detectionInput
        ? [detectionInput?.input.shape[1], detectionInput?.input.shape[0]]
        : undefined,
      people: this.currentPeople.map(d => d.detection),
      faces,
    }

    if (detectionInput)
      this.setDetection(detectionId, detectionInput);

    this.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);
  }

  async peopleDetected(detectionResult: ObjectsDetected) {
    if (!detectionResult?.people) {
      return;
    }

    const found: DenoisedDetectionEntry<FaceRecognitionResult>[] = [];
    denoiseDetections<FaceRecognitionResult>(this.currentPeople, detectionResult.people.map(detection => ({
      name: detection.id,
      detection,
    })), {
      added: d => found.push(d),
      removed: d => {
        this.console.log('no longer detected', d.name)
        this.reportPeopleDetections(undefined)
      }
    });
    if (found.length) {
      this.console.log('detected', found.map(d => d.detection.label).join(', '));
      this.extendedFaceDetect();
    }

    this.reportPeopleDetections(detectionResult.faces);
  }

  async extendedFaceDetect() {
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
      duration: 60000,
    });
  }

  setDetection(detectionId: string, detectionInput: DetectionInput) {
    // this.detections.set(detectionId, detectionInput);
    // setTimeout(() => {
    //   this.detections.delete(detectionId);
    //   detectionInput?.input?.dispose();
    // }, DISPOSE_TIMEOUT);
  }

  async getNativeObjectTypes(): Promise<ObjectDetectionTypes> {
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
      return this.mixinDevice.getObjectTypes();
    return {};
  }

  async getObjectTypes(): Promise<ObjectDetectionTypes> {
    const models = await this.objectDetection?.getInferenceModels();
    return {
      classes: models?.[0]?.classes || [],
      faces: true,
      people: models?.[0]?.people,
    }
  }

  async getDetectionInput(detectionId: any): Promise<MediaObject> {
    const detection = this.detections.get(detectionId);
    if (!detection) {
      if (this.mixinDeviceInterfaces.includes(ScryptedInterface.ObjectDetector))
        return this.mixinDevice.getDetectionInput(detectionId);
      return;
    }
    // if (!detection.jpegBuffer) {
    //   detection.jpegBuffer = Buffer.from(await encodeJpeg(detection.input));
    // }
    return mediaManager.createMediaObject(detection.jpegBuffer, 'image/jpeg');
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Object Detector',
        key: 'objectDetection',
        type: 'device',
        deviceFilter: `interfaces.includes("${ScryptedInterface.ObjectDetection}")`,
        value: this.storage.getItem('objectDetection'),
      },
      {
        title: 'Minimum Face Detection Confidence',
        description: 'Higher values eliminate false positives and low quality recognition candidates.',
        key: 'minConfidence',
        type: 'number',
        value: this.minConfidence.toString(),
      },
      {
        title: 'Detection Duration',
        description: 'The duration to process video when an event occurs.',
        key: 'detectionDuration',
        type: 'number',
        value: this.detectionDuration.toString(),
      },
      {
        title: 'Object Detection Interval',
        description: 'The interval used to detect objects when motion is detected',
        key: 'objectInterval',
        type: 'number',
        value: this.objectInterval.toString(),
      },
      {
        title: 'Face Recognition Interval',
        description: 'The interval used to recognize faces when a person is detected',
        key: 'recognitionInterval',
        type: 'number',
        value: this.recognitionInterval.toString(),
      },
    ];
  }

  async putMixinSetting(key: string, value: string | number | boolean): Promise<void> {
    const vs = value.toString();
    this.storage.setItem(key, vs);
    if (key === 'minConfidence') {
      this.minConfidence = parseInt(vs) || 0.5;
    }
    else if (key === 'detectionDuration') {
      this.detectionDuration = parseInt(vs) || defaultDetectionDuration;
    }
    else if (key === 'objectInterval') {
      this.objectInterval = parseInt(vs) || defaultObjectInterval;
    }
    else if (key === 'recognitionInterval') {
      this.recognitionInterval = parseInt(vs) || defaultRecognitionInterval;
    }
    else if (key === 'objectDetection') {
      this.bindObjectDetection();
    }
  }

  release() {
    this.released = true;
    this.registerMotion?.removeListener();
    this.objectDetection?.detectObjects(undefined, {
      detectionId: this.detectionId,
    });
  }
}

class ObjectDetectionPlugin extends ScryptedDeviceBase implements MixinProvider {
  constructor(nativeId?: string) {
    super(nativeId);

    // trigger mixin creation. todo: fix this to not be stupid hack.
    for (const id of Object.keys(systemManager.getSystemState())) {
      const device = systemManager.getDeviceById<VideoCamera & Settings>(id);
      if (!device.mixins?.includes(this.id))
        continue;
      device.getSettings();
    }
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
    if ((interfaces.includes(ScryptedInterface.VideoCamera) || interfaces.includes(ScryptedInterface.Camera))
      && interfaces.includes(ScryptedInterface.MotionSensor)) {
      return [ScryptedInterface.ObjectDetector, ScryptedInterface.Settings];
    }
    return null;
  }

  async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    return new ObjectDetectionMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this);
  }
  async releaseMixin(id: string, mixinDevice: any) {
    mixinDevice.release();
  }
}

export default new ObjectDetectionPlugin();
