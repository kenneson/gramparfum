// Monta dist-hostinger/ a partir do build standalone (rodar depois de `npm run build`).
// A Hostinger só instala dependências e inicia `node server.js`; não compila nada (glibc antiga).
// node_modules não vai no pacote: o `npm install` da Hostinger recria a partir do package-lock.
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const OUT = "dist-hostinger";
rmSync(OUT, { recursive: true, force: true });
cpSync(".next/standalone", OUT, { recursive: true, filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) });
cpSync(".next/static", `${OUT}/.next/static`, { recursive: true });
cpSync("public", `${OUT}/public`, { recursive: true });
cpSync("package-lock.json", `${OUT}/package-lock.json`);

// HOSTNAME às vezes vem com o nome da máquina; o proxy da Hostinger precisa de 0.0.0.0
const server = readFileSync(`${OUT}/server.js`, "utf8");
writeFileSync(`${OUT}/server.js`, `process.env.HOSTNAME = "0.0.0.0";\n${server}`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.main = "server.js";
pkg.scripts = { build: 'echo "Build feito no GitHub Actions"', start: "node server.js" };
pkg.engines = { node: ">=20.9" };
writeFileSync(`${OUT}/package.json`, JSON.stringify(pkg, null, 2) + "\n");

writeFileSync(
  `${OUT}/LEIA-ME.txt`,
  "Branch gerada automaticamente pelo GitHub Actions a partir da main. Não edite aqui.\n" +
    "Hostinger: build = npm run build (não faz nada), arquivo de entrada = server.js, Node >= 20.\n",
);
console.log(`${OUT}/ pronto`);
