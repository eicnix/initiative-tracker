import {
    Component,
    MarkdownPostProcessorContext,
    MarkdownRenderChild,
    Notice,
    parseYaml
} from "obsidian";
import type InitiativeTracker from "../main";
import { Creature } from "../utils/creature";

import EncounterUI from "./ui/Encounter.svelte";
import EncounterTable from "./ui/EncounterTable.svelte";

type RawCreatureArray = string | Array<string | { [key: number]: string }>;
type RawCreature = string | { [key: number]: string };
type RawPlayers = boolean | "none" | string[];
interface EncounterParameters {
    name?: string;
    players?: RawPlayers;
    hide?: "players" | "creatures" | string[];
    creatures?: RawCreatureArray;
    xp?: number;
}
interface CreatureStats {
    name: string;
    ac: number;
    hp: number;
    modifier: number;
    xp: number;
}

export const equivalent = (
    creature: Creature | CreatureStats,
    existing: Creature | CreatureStats
) => {
    return (
        creature.name == existing.name &&
        creature.ac == existing.ac &&
        creature.hp == existing.hp &&
        creature.modifier == existing.modifier &&
        creature.xp == existing.xp
    );
};

export interface ParsedParams {
    name: string;
    players: string[];
    hide: string[];
    creatures: Map<Creature, string | number>;
    xp: number;
    playerLevels: number[];
}

export class EncounterParser {
    constructor(public plugin: InitiativeTracker) {}
    async parse(params: EncounterParameters): Promise<ParsedParams> {
        const name = params.name;
        const players: string[] = this.parsePlayers(params);
        const hide = this.parseHide(params);
        const rawMonsters = params.creatures ?? [];

        let creatures = await this.parseRawCreatures(rawMonsters);

        const xp = params.xp ?? null;
        const playerLevels = this.plugin.data.players
            .map((p) => p.level)
            .filter((p) => p);

        return {
            name,
            players,
            hide,
            creatures,
            xp,
            playerLevels
        };
    }
    parseHide(params: EncounterParameters): string[] {
        if (!("hide" in (params ?? {}))) return [];
        if (typeof params.hide == "string")
            return ["creatures", "players"].filter((v) => params.hide == v);
        if (Array.isArray(params.hide))
            return ["creatures", "players"].filter((v) =>
                params.hide.includes(v)
            );

        return [];
    }
    parsePlayers(params: EncounterParameters) {
        const players = params.players;
        if (players == "none" || players == false) {
            return [];
        }
        if (!players || players == true) {
            return [...this.plugin.data.players.map((p) => p.name)];
        }
        if (typeof players == "string") {
            return [players];
        }
        if (Array.isArray(players)) {
            return (this.plugin.data.players ?? [])
                .filter((p) =>
                    players
                        .map((n) => n.toLowerCase())
                        .includes(p.name.toLowerCase())
                )
                .map((p) => p.name);
        }
    }
    async parseRawCreatures(rawMonsters: RawCreatureArray) {
        const creatureMap: Map<Creature, number | string> = new Map();
        if (rawMonsters && Array.isArray(rawMonsters)) {
            for (const raw of rawMonsters) {
                const { creature, number = 1 } =
                    this.parseRawCreature(raw) ?? {};
                if (!creature) continue;

                const stats = {
                    name: creature.name,
                    ac: creature.ac,
                    hp: creature.hp,
                    modifier: creature.modifier,
                    xp: creature.xp
                };
                const existing = [...creatureMap].find(([c]) =>
                    equivalent(c, stats)
                );
                if (!existing) {
                    creatureMap.set(creature, number);
                } else {
                    let amount;
                    if (!isNaN(Number(number)) && !isNaN(Number(existing[1]))) {
                        amount =
                            (Number(number) as number) +
                            (existing[1] as number);
                    } else {
                        amount = `${number} + ${existing[1]}`;
                    }

                    creatureMap.set(existing[0], amount);
                }
            }
        }
        return creatureMap;
    }
    parseRawCreature(raw: RawCreature) {
        if (!raw) return {};
        let monster: string,
            number = 1;
        if (typeof raw == "string") {
            const match = raw.match(/(\d+)?:?\s?(.+)/);
            number = isNaN(Number(match[1] ?? null))
                ? number
                : Number(match[1]);
            monster = match[2];
        } else if (typeof raw == "object") {
            let entries = Object.entries(raw).flat();
            number = entries[0];
            monster = entries[1];
        }

        if (!monster) return {};

        if (
            typeof number == "string" &&
            !this.plugin.canUseDiceRoller &&
            /\d+d\d+/.test(number)
        ) {
            number = 1;
        }
        if (!isNaN(Number(number))) number = Number(number);
        if (!number || (typeof number == "number" && number < 1)) number = 1;

        let name = monster.split(/,\s?/)[0];
        let [hp, ac, mod, xp] = monster
            .split(/,\s?/)
            .slice(1)
            .map((v) => (isNaN(Number(v)) ? null : Number(v)));
        if (!name) return {};

        let existing = this.plugin.bestiary.find((c) => c.name == name);
        let creature = existing
            ? Creature.from(existing)
            : new Creature({ name });

        creature.hp = hp ?? creature.hp;
        creature.ac = ac ?? creature.ac;
        creature.modifier = mod ?? creature.modifier;
        creature.xp = xp ?? creature.xp;

        return { creature, number };
    }
}

class EncounterComponent {
    instance: EncounterUI;
    constructor(
        public params: ParsedParams,
        public encounterEl: HTMLElement,
        public plugin: InitiativeTracker
    ) {
        this.display();
    }
    async display() {
        this.instance = new EncounterUI({
            target: this.encounterEl,
            props: {
                plugin: this.plugin,
                name: this.params.name,
                players: this.params.players,
                playerLevels: this.params.playerLevels,
                creatures: this.params.creatures,
                xp: this.params.xp,
                hide: this.params.hide
            }
        });
    }
}

export class EncounterBlock extends MarkdownRenderChild {
    parser = new EncounterParser(this.plugin);
    constructor(
        public plugin: InitiativeTracker,
        public src: string,
        public containerEl: HTMLElement,
        public table = false
    ) {
        super(containerEl);
    }
    onload(): void {
        if (this.table) {
            this.postprocessTable();
        } else {
            this.postprocess();
        }
    }
    async postprocess() {
        const encounters = this.src.split("---") ?? [];
        const containerEl = this.containerEl.createDiv("encounter-container");
        const empty = containerEl.createSpan({
            text: "No encounters created. Please check your syntax and try again."
        });

        for (let encounter of encounters) {
            if (!encounter?.trim().length) continue;
            try {
                const params: EncounterParameters = parseYaml(encounter);
                new EncounterComponent(
                    await this.parser.parse(params),
                    containerEl.createDiv("encounter-instance"),
                    this.plugin
                );
                empty.detach();
            } catch (e) {
                console.error(e);
                new Notice(
                    "Initiative Tracker: here was an issue parsing: \n\n" +
                        encounter
                );
            }
        }
        this.registerEvent(
            this.plugin.app.workspace.on("initiative-tracker:unload", () => {
                this.containerEl.empty();
                this.containerEl.createEl("pre").createEl("code", {
                    text: `\`\`\`encounter\n${this.src}\`\`\``
                });
            })
        );
    }
    async postprocessTable() {
        const encounterSource = this.src.split("---") ?? [];
        const containerEl = this.containerEl.createDiv("encounter-container");
        const empty = containerEl.createSpan({
            text: "No encounters created. Please check your syntax and try again."
        });

        const encounters: ParsedParams[] = [];

        for (let encounter of encounterSource) {
            if (!encounter?.trim().length) continue;
            try {
                const params: EncounterParameters = parseYaml(encounter);
                encounters.push(await this.parser.parse(params));
            } catch (e) {
                console.error(e);
                new Notice(
                    "Initiative Tracker: here was an issue parsing: \n\n" +
                        encounter
                );
            }
        }
        if (encounters.length) {
            empty.detach();
            new EncounterTable({
                target: this.containerEl,
                props: {
                    encounters,
                    plugin: this.plugin
                }
            });
        }
        this.registerEvent(
            this.plugin.app.workspace.on("initiative-tracker:unload", () => {
                this.containerEl.empty();
                this.containerEl.createEl("pre").createEl("code", {
                    text: `\`\`\`encounter-table\n${this.src}\`\`\``
                });
            })
        );
    }
}