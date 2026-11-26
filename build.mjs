import esbuild from "esbuild";
await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "cjs", platform: "browser", target: "es2020", outfile: "index.js", external: ["siyuan"], minify: false, legalComments: "none" });
