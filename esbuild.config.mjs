import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import process from "process";
import builtins from "builtin-modules";
import { config } from "dotenv";

config();

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";

const dir = prod ? "./" : process.env.OUTDIR;

const parameters = {
    banner: {
        js: banner
    },
    entryPoints: ["src/main.ts", "src/styles.css"],
    bundle: true,
    external: ["obsidian", "electron", ...builtins],
    format: "cjs",
    logLevel: "info",
    target: "es2020",
    treeShaking: true,
    sourcemap: prod ? false : "inline",
    minify: prod,
    plugins: [
        sveltePlugin({
            compilerOptions: { css: true },
            preprocess: sveltePreprocess(),
            filterWarnings: (warning) => {
                return warning.code != "a11y-click-events-have-key-events";
            }
        })
    ],
    outdir: dir
};

if (prod) {
    await esbuild.build(parameters).catch((x) => {
        if (x.errors) {
            console.error(x.errors);
        } else {
            console.error(x);
        }
        process.exit(1);
    });
} else {
    let ctx = await esbuild.context(parameters);
    await ctx.watch();
}
