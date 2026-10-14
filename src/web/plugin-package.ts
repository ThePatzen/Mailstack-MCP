import { deflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    directoryParts.push(directory, name);

    offset += local.length + name.length + compressed.length;
  }

  const directorySize = directoryParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...directoryParts, end]);
}

function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8') };
}

export function pluginPackageName(pluginName: string): string {
  const slug = pluginName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  if (!slug) throw new Error('PLUGIN_NAME must include at least one ASCII letter or number.');
  return slug;
}

export function createMailstackPluginArchive(mcpUrl: string, pluginName: string): Buffer {
  const origin = new URL(mcpUrl).origin;
  const packageName = pluginPackageName(pluginName);
  const pluginJson = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: packageName,
    version: '0.1.0',
    description: `Greift mit den freigegebenen Funktionen sicher auf ein Mailpostfach zu.`,
    author: { name: pluginName },
    homepage: `${origin}/manage`,
    keywords: ['email', 'imap', 'mail'],
    extensions: {
      'com.openai': {
        interface: {
          displayName: pluginName,
          shortDescription: `${pluginName} per MCP`,
          longDescription: `Verbindet sich mit Ihrem ${pluginName}-Server. Die verfügbaren Funktionen richten sich nach den Berechtigungen des verwendeten User-Tokens.`,
          developerName: pluginName,
          category: 'Productivity',
          capabilities: ['Read', 'Write'],
          websiteURL: `${origin}/manage`,
          defaultPrompt: 'Hilf mir, mein Mailpostfach sicher zu verwalten.',
        },
        onboardingSkill: './skills/setup/SKILL.md',
      },
    },
  };
  const mcpJson = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      [packageName]: {
        type: 'streamable-http',
        url: mcpUrl,
        extensions: {
          'com.openai': {
            auth: { type: 'api_key', headerScheme: 'bearer' },
          },
        },
      },
    },
  };
  const setupSkill = `---
name: setup
description: Erklärt die Verbindung mit dem persönlichen ${pluginName}-Server.
---

# ${pluginName} verbinden

Der Server-Endpunkt dieses Plugins ist \`${mcpUrl}\`.

Bei der Verbindung fragt Codex oder die ChatGPT-Desktop-App nach einem API-Key. Fügen Sie dort ein persönliches **User-Token** aus der Verwaltungsoberfläche ein. Der Server verwendet dieses Token als Bearer-Token und beschränkt den Zugriff auf die dafür freigegebenen Funktionen.

Geben Sie das Token niemals in den Chat ein und speichern Sie es nicht in Plugin-Dateien. Wenn Sie den Wert verloren haben, erstellen Sie in der Verwaltung ein neues Token und widerrufen Sie das alte.

Das statische Verwaltungstoken wird ausschließlich für die Anmeldung auf \`${origin}/manage\` benötigt. Es funktioniert nicht als MCP-Zugang.
`;
  const installGuide = `# ${pluginName} Plugin installieren

Dieses Paket enthält die Verbindung zu \`${mcpUrl}\`. Es enthält keine Zugangsdaten.

## Codex und ChatGPT-Desktop-App

1. Entpacken Sie das Archiv in \`~/.codex/plugins\`; dadurch entsteht der Ordner \`~/.codex/plugins/${packageName}\`.
2. Legen Sie \`~/.agents/plugins/marketplace.json\` an oder ergänzen Sie die Datei um diesen Eintrag:

\`\`\`json
{
  "name": "mailstack-local",
  "plugins": [
    {
      "name": "${packageName}",
      "source": { "source": "local", "path": "./.codex/plugins/${packageName}" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
\`\`\`

3. Starten Sie die ChatGPT-Desktop-App neu und installieren Sie ${pluginName} unter **Plugins** aus der Quelle \`mailstack-local\`. In Codex CLI können Sie den Plugin-Browser mit \`/plugins\` öffnen.
4. Geben Sie beim Verbinden ein persönliches User-Token ein. Erstellen oder widerrufen Sie Tokens unter \`${origin}/manage\`.

Der Plugin-Ordner ist lokal installiert. Damit andere Nutzer das Plugin beziehen können, muss es über eine gemeinsame Marketplace-Quelle verteilt werden.
`;

  return zip([
    jsonEntry(`${packageName}/plugin.json`, pluginJson),
    jsonEntry(`${packageName}/mcp.json`, mcpJson),
    { name: `${packageName}/skills/setup/SKILL.md`, data: Buffer.from(setupSkill, 'utf8') },
    { name: `${packageName}/INSTALL.md`, data: Buffer.from(installGuide, 'utf8') },
  ]);
}
