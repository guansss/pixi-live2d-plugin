import type { MotionManager } from "@/cubism-common/MotionManager";
import type { ModelSettings } from "@/cubism-common/ModelSettings";
import { MotionPriority, MotionState } from "@/cubism-common/MotionState";
import { logger } from "@/utils";
import { utils } from "@pixi/core";
import type { Mutable } from "../types/helpers";




/**
 * Handles the motion playback.
 * @emits {@link MotionManagerEvents}
 */
export abstract class ParallelMotionManager<Motion = any, MotionSpec = any> extends utils.EventEmitter {
    /**
     * Tag for logging.
     */
    tag: string;

    manager: MotionManager;


    /**
     * The ModelSettings reference.
     */
    readonly settings: ModelSettings;


    /**
     * Maintains the state of this MotionManager.
     */
    state = new MotionState();


    /**
     * Flags there's a motion playing.
     */
    playing = false;

    /**
     * Flags the instances has been destroyed.
     */
    destroyed = false;

    protected constructor(settings: ModelSettings, manager: MotionManager) {
        super();
        this.settings = settings;
        this.tag = `ParallelMotionManager(${settings.name})`;
        this.state.tag = this.tag;
        this.manager = manager;
    }

    /**
     * Starts a motion as given priority.
     * @param group - The motion group.
     * @param index - Index in the motion group.
     * @param priority - The priority to be applied. default: 2 (NORMAL)
     * ### OPTIONAL: {name: value, ...}
     * @param sound - The audio url to file or base64 content
     * @param volume - Volume of the sound (0-1)
     * @param expression - In case you want to mix up a expression while playing sound (bind with Model.expression())
     * @param resetExpression - Reset expression before and after playing sound (default: true)
     * @param crossOrigin - Cross origin setting.
     * @return Promise that resolves with true if the motion is successfully started, with false otherwise.
     */
    async startMotion(
        group: string,
        index: number,
        priority: MotionPriority = MotionPriority.NORMAL,
    ): Promise<boolean> {
        if (!this.state.reserve(group, index, priority)) {
            return false;
        }


        const definition = this.manager.definitions[group]?.[index];
        if (!definition) {
            return false;
        }

        const motion = await this.manager.loadMotion(group, index);


        if (!this.state.start(motion, group, index, priority)) {
            return false;
        }
        logger.log(this.tag, "Start motion:", this.getMotionName(definition));

        this.emit("motionStart", group, index, undefined);

        this.playing = true;

        this._startMotion(motion!);

        return true;
    }

    /**
     * Starts a random Motion as given priority.
     * @param group - The motion group.
     * @param priority - The priority to be applied. (default: 1 `IDLE`)
     * ### OPTIONAL: {name: value, ...}
     * @param sound - The wav url file or base64 content+
     * @param volume - Volume of the sound (0-1) (default: 1)
     * @param expression - In case you want to mix up a expression while playing sound (name/index)
     * @param resetExpression - Reset expression before and after playing sound (default: true)
     * @return Promise that resolves with true if the motion is successfully started, with false otherwise.
     */
    async startRandomMotion(
        group: string,
        priority?: MotionPriority
    ): Promise<boolean> {
        const groupDefs = this.manager.definitions[group];

        if (groupDefs?.length) {
            const availableIndices: number[] = [];

            for (let i = 0; i < groupDefs!.length; i++) {
                if (this.manager.motionGroups[group]![i] !== null && !this.state.isActive(group, i)) {
                    availableIndices.push(i);
                }
            }

            if (availableIndices.length) {
                const index =
                    availableIndices[Math.floor(Math.random() * availableIndices.length)]!;

                return this.startMotion(group, index, priority);
            }
        }

        return false;
    }

    /**
     * Stops all playing motions as well as the sound.
     */
    stopAllMotions(): void {
        this._stopAllMotions();

        this.state.reset();

    }

    /**
     * Updates parameters of the core model.
     * @param model - The core model.
     * @param now - Current time in milliseconds.
     * @return True if the parameters have been actually updated.
     */
    update(model: object, now: DOMHighResTimeStamp): boolean {
        if (this.isFinished()) {
            if (this.playing) {
                this.playing = false;
                this.emit("motionFinish");
            }

            this.state.complete();
        }
        return this.updateParameters(model, now);
    }


    /**
     * Destroys the instance.
     * @emits {@link MotionManagerEvents.destroy}
     */
    destroy() {
        this.destroyed = true;
        this.emit("destroy");

        this.stopAllMotions();

        const self = this as Mutable<Partial<this>>;
    }

    /**
     * Checks if the motion playback has finished.
     */
    abstract isFinished(): boolean;

    /**
     * Retrieves the motion's name by its definition.
     * @return The motion's name.
     */
    protected abstract getMotionName(definition: MotionSpec): string;

    /**
     * Starts the Motion.
     */
    protected abstract _startMotion(motion: Motion, onFinish?: (motion: Motion) => void): number;

    /**
     * Stops all playing motions.
     */
    protected abstract _stopAllMotions(): void;

    /**
     * Updates parameters of the core model.
     * @param model - The core model.
     * @param now - Current time in milliseconds.
     * @return True if the parameters have been actually updated.
     */
    protected abstract updateParameters(model: object, now: DOMHighResTimeStamp): boolean;
}
