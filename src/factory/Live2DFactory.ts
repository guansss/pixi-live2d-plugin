import { ExpressionManager, InternalModel, ModelSettings, MotionManager } from '@/cubism-common';
import { Live2DLoader } from '@/factory/Live2DLoader';
import { Live2DModel, Live2DModelOptions } from '@/Live2DModel';
import { logger } from '@/utils';
import { Middleware, runMiddlewares } from '@/utils/middleware';
import { Texture } from '@pixi/core';

const TAG = 'Live2DFactory';

export interface Live2DFactoryOptions extends Live2DModelOptions {
    /**
     * String to use for crossOrigin properties on `<img>` elements.
     * @default undefined
     */
    crossOrigin?: string;
}

export interface Live2DFactoryContext {
    source: any,
    options: Live2DFactoryOptions;
    live2DModel: Live2DModel;
    internalModel?: InternalModel;
    settings?: ModelSettings;
}

export interface Live2DPlatform {
    version: number;

    createModelSettings(json: any): ModelSettings | undefined;

    test(settings: ModelSettings): settings is ModelSettings;

    createCoreModel(data: ArrayBuffer): any;

    createInternalModel(coreModel: any, settings: ModelSettings, options?: Live2DFactoryOptions): InternalModel;

    createPose(coreModel: any, data: any): any;

    createPhysics(coreModel: any, data: any): any;
}

export const urlToJSON: Middleware<Live2DFactoryContext> = async (context, next) => {
    if (typeof context.source === 'string') {
        const data = await Live2DLoader.load({
            url: context.source,
            type: 'json',
            target: context.live2DModel,
        });

        data.url = context.source;

        context.source = data;

        context.live2DModel.emit('settingsJSONLoaded', data);
    }

    return next();
};

export const jsonToSettings: Middleware<Live2DFactoryContext> = async (context, next) => {
    if (context.source instanceof ModelSettings) {
        context.settings = context.source;

        return next();
    } else if (typeof context.source === 'object') {
        for (const platform of Live2DFactory.platforms) {
            const settings = platform.createModelSettings(context.source);

            if (settings) {
                context.settings = settings;
                context.live2DModel.emit('settingsLoaded', settings);

                return next();
            }
        }
    }

    throw new TypeError('Unknown settings format.');
};

export const createInternalModel: Middleware<Live2DFactoryContext> = async (context, next) => {
    const settings = context.settings;

    if (settings instanceof ModelSettings) {
        const platform = Live2DFactory.platforms.find(f => f.test(settings));

        if (!platform) {
            throw new TypeError('Unknown model settings.');
        }

        const modelData = await Live2DLoader.load({
            settings,
            url: settings.moc,
            type: 'arraybuffer',
            target: context.live2DModel,
        });

        const coreModel = platform.createCoreModel(modelData);

        context.internalModel = platform.createInternalModel(coreModel, settings, context.options);

        return next();
    }

    throw new TypeError('Missing settings.');
};

export const setupOptionals: Middleware<Live2DFactoryContext> = (context, next) => {
    const internalModel = context.internalModel;

    if (internalModel) {
        const settings = context.settings!;
        const platform = Live2DFactory.platforms.find(f => f.test(settings));

        if (platform) {
            if (settings.pose) {
                // no need to await the returned promise as the resources are optional
                Live2DLoader.load({
                        settings,
                        url: settings.pose,
                        type: 'json',
                        target: internalModel,
                    })
                    .then((data: ArrayBuffer) => internalModel.pose = platform.createPose(internalModel.coreModel, data))
                    .catch((e: Error) => logger.warn(TAG, 'Failed to load pose.\n', e));
            }
            if (settings.physics) {
                Live2DLoader.load({
                        settings,
                        url: settings.physics,
                        type: 'json',
                        target: internalModel,
                    })
                    .then((data: ArrayBuffer) => internalModel.physics = platform.createPhysics(internalModel.coreModel, data))
                    .catch((e: Error) => logger.warn(TAG, 'Failed to load physics.\n', e));
            }
        }
    }

    return next();
};

export const setupLive2DModel: Middleware<Live2DFactoryContext> = async (context, next) => {
    if (context.settings) {
        const live2DModel = context.live2DModel;

        live2DModel.textures = context.settings.textures.map(tex => {
            const url = context.settings!.resolveURL(tex);
            return Texture.from(url, { resourceOptions: { crossorigin: context.options.crossOrigin } });
        });
        live2DModel.emit('textureAdded', live2DModel.textures);

        let allTexturesValid = true;

        const onUpdate = () => {
            if (!live2DModel.textureValid && live2DModel.textures.every(tex => tex.valid)) {
                live2DModel.textureValid = true;
                live2DModel.emit('textureLoaded');
            }
        };

        live2DModel.textures.forEach(texture => {
            if (!texture.valid) {
                allTexturesValid = false;
                texture.on('update', onUpdate);
            }
        });

        allTexturesValid && onUpdate();

        await next();

        if (context.internalModel) {
            live2DModel.internalModel = context.internalModel;
            live2DModel.emit('modelLoaded', context.internalModel);
        } else {
            throw new TypeError('Missing internal model.');
        }
    } else {
        throw new TypeError('Missing settings.');
    }
};

export class Live2DFactory {
    static platforms: Live2DPlatform[] = [];

    static live2DModelMiddlewares: Middleware<Live2DFactoryContext>[] = [
        urlToJSON, jsonToSettings, setupLive2DModel, createInternalModel, setupOptionals,
    ];

    /**
     * loading tasks of each motion. The structure of each value in this map is the same as {@link MotionManager#definitions}.
     */
    static motionTasksMap = new WeakMap<MotionManager, Record<string, Promise<any>[]>>();

    static expressionTasksMap = new WeakMap<ExpressionManager, Promise<any>[]>();

    static registerPlatform(platform: Live2DPlatform) {
        this.platforms.push(platform);

        // higher version as higher priority
        this.platforms.sort((a, b) => b.version - a.version);
    }

    static async createLive2DModel<IM extends InternalModel>(
        Live2DModelConstructor: { new(...args: ConstructorParameters<typeof Live2DModel>): Live2DModel<IM> },
        source: string | object | IM['settings'],
        options?: Live2DFactoryOptions,
    ): Promise<Live2DModel<IM>> {
        const live2DModel = new Live2DModelConstructor(options);

        await runMiddlewares(this.live2DModelMiddlewares, {
            live2DModel,
            source,
            options: options || {},
        });

        return live2DModel;
    }

    static loadMotion<Motion, MotionSpec, Groups extends string>(motionManager: MotionManager<Motion, MotionSpec, Groups>, group: Groups, index: number): Promise<Motion | undefined> {
        try {
            const definition = motionManager.definitions[group] ?. [index];

            if (!definition) {
                return Promise.resolve(undefined);
            }

            if (!motionManager.listeners('destroy').includes(this.releaseTasks)) {
                motionManager.once('destroy', this.releaseTasks, this);
            }

            let tasks = this.motionTasksMap.get(motionManager);

            if (!tasks) {
                tasks = {};
                this.motionTasksMap.set(motionManager, tasks);
            }

            let taskGroup = tasks[group];

            if (!taskGroup) {
                taskGroup = [];
                tasks[group] = taskGroup;
            }

            const path = motionManager.getMotionFile(definition);

            taskGroup[index] ??= Live2DLoader.load({
                    url: path,
                    settings: motionManager.settings,
                    type: motionManager.motionDataType,
                    target: motionManager,
                })
                .then(data => {
                    const taskGroup = this.motionTasksMap.get(motionManager)?.[group];

                    if (taskGroup) {
                        delete taskGroup[index];
                    }

                    return motionManager.createMotion(data, definition);
                })
                .catch(e => logger.warn(motionManager.tag, `Failed to load motion: ${path}\n`, e));

            return taskGroup[index]!;
        } catch (e) {
            logger.warn(motionManager.tag, `Failed to load motion at "${group}"[${index}]\n`, e);
        }

        return Promise.resolve(undefined);
    }

    static loadExpression<Expression, ExpressionSpec>(expressionManager: ExpressionManager<Expression, ExpressionSpec>, index: number): Promise<Expression | undefined> {
        try {
            const definition = expressionManager.definitions[index];

            if (!definition) {
                return Promise.resolve(undefined);
            }

            if (!expressionManager.listeners('destroy').includes(this.releaseTasks)) {
                expressionManager.once('destroy', this.releaseTasks, this);
            }

            let tasks = this.expressionTasksMap.get(expressionManager);

            if (!tasks) {
                tasks = [];
                this.expressionTasksMap.set(expressionManager, tasks);
            }

            const path = expressionManager.getExpressionFile(definition);

            tasks[index] ??= Live2DLoader.load({
                    url: path,
                    settings: expressionManager.settings,
                    type: 'json',
                    target: expressionManager,
                })
                .then(data => {
                    const tasks = this.expressionTasksMap.get(expressionManager);

                    if (tasks) {
                        delete tasks[index];
                    }

                    return expressionManager.createExpression(data, definition);
                })
                .catch(e => logger.warn(expressionManager.tag, `Failed to load expression: ${path}\n`, e));

            return tasks[index]!;
        } catch (e) {
            logger.warn(expressionManager.tag, `Failed to load expression at [${index}]\n`, e);
        }

        return Promise.resolve(undefined);
    }

    static releaseTasks(target: MotionManager | ExpressionManager) {
        if (target instanceof MotionManager) {
            this.motionTasksMap.delete(target);
        } else {
            this.expressionTasksMap.delete(target);
        }
    }
}

(MotionManager.prototype as any)._loadMotion = function(this: MotionManager, group: string, index: number) {
    return Live2DFactory.loadMotion(this, group, index);
};

(ExpressionManager.prototype as any)._loadExpression = function(this: ExpressionManager, index: number) {
    return Live2DFactory.loadExpression(this, index);
};