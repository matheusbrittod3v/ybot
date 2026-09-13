import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const COOKIES_PATH = path.join(DATA_DIR, 'cookies.txt');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function formatCookieNetscape(c) {
  let domain = c.domain;
  const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
  const path = c.path || '/';
  const secure = c.secure ? 'TRUE' : 'FALSE';
  const expiration = c.expires && c.expires > 0 ? Math.floor(c.expires) : Math.floor(Date.now() / 1000) + 31536000;
  const name = c.name;
  const value = c.value;
  return `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`;
}

async function run() {
  console.log('===========================================================');
  console.log('  LOGIN GOOGLE / YOUTUBE & CAPTURA AUTOMÁTICA DE COOKIES   ');
  console.log('===========================================================\n');
  console.log('1. Abrindo navegador para você fazer login na sua conta...');

  const userDataDir = path.join(__dirname, '.browser_session');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 850 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('2. Acessando página de login do Google / YouTube...');
  await page.goto('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F', {
    waitUntil: 'domcontentloaded'
  });

  console.log('\n-----------------------------------------------------------');
  console.log('👉 Na janela do navegador que se abriu:');
  console.log('   1. Digite seu e-mail e senha do Google.');
  console.log('   2. Conclua qualquer verificação em duas etapas.');
  console.log('   3. Quando você estiver logado e vendo o YouTube:');
  console.log('      Volte aqui no terminal e pressione a tecla [ENTER]!');
  console.log('-----------------------------------------------------------\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    rl.question('Pressione ENTER assim que tiver concluído o login no YouTube... ', () => {
      rl.close();
      resolve();
    });
  });

  console.log('\n3. Extraindo cookies da sessão autenticada...');
  const cookies = await context.cookies([
    'https://www.youtube.com',
    'https://youtube.com',
    'https://google.com',
    'https://accounts.google.com',
    'https://studio.youtube.com'
  ]);

  const hasAuthCookie = cookies.some(c => ['SID', 'SSID', 'HSID', 'LOGIN_INFO', '__Secure-3PSID'].includes(c.name));

  if (!hasAuthCookie) {
    console.warn('⚠️ AVISO: Não encontramos cookies de login autenticado (SID/LOGIN_INFO). Certifique-se de que a conta entrou de fato no YouTube.');
  }

  const netscapeLines = [
    '# Netscape HTTP Cookie File',
    '# Generated automatically via TV Braza Google/YouTube Login',
    '# http://curl.haxx.se/rfc/cookie_spec.html',
    ''
  ];

  for (const c of cookies) {
    netscapeLines.push(formatCookieNetscape(c));
  }

  const outputContent = netscapeLines.join('\n') + '\n';
  fs.writeFileSync(COOKIES_PATH, outputContent, 'utf-8');

  console.log('\n===========================================================');
  console.log(`✅ SUCESSO! ${cookies.length} cookies capturados com sucesso!`);
  console.log(`📁 Arquivo salvo em: ${COOKIES_PATH}`);
  console.log(`📊 Tamanho do arquivo: ${Buffer.byteLength(outputContent)} bytes`);
  console.log('===========================================================\n');
  console.log('O arquivo cookies.txt da sua conta foi atualizado no sistema local.');
  console.log('Você pode fechar a janela do navegador.');

  await context.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Erro ao executar login:', err.message);
  process.exit(1);
});
