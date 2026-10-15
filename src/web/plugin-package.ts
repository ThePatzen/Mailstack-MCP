import { deflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Calculates the checksum required by ZIP records for the uncompressed entry data. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a small ZIP archive from entries without relying on an external archiver. */
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

/** Encodes a value as a readable JSON file inside the generated archive. */
function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8') };
}

/** Converts a display name into the stable ASCII slug used for package paths and identifiers. */
export function pluginPackageName(pluginName: string): string {
  const slug = pluginName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  if (!slug) throw new Error('PLUGIN_NAME must include at least one ASCII letter or number.');
  return slug;
}

/** Derives the bearer-token environment variable from the configured plugin name. */
export function pluginTokenEnvironmentName(pluginName: string): string {
  return `MAILSTACK_MCP_${pluginPackageName(pluginName).replace(/-/g, '_').toUpperCase()}_TOKEN`;
}

/** Generates the plugin files at their root paths for ZIP and Git marketplace packaging. */
export function createMailstackPluginFiles(mcpUrl: string, pluginName: string, options: { includeMcpConfig?: boolean } = {}): ZipEntry[] {
  const origin = new URL(mcpUrl).origin;
  const packageName = pluginPackageName(pluginName);
  const tokenEnvironmentName = pluginTokenEnvironmentName(pluginName);
  const pluginJson = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: packageName,
    version: '0.1.0',
    description: `Greift mit den freigegebenen Funktionen sicher auf ein Mailpostfach zu.`,
    author: { name: pluginName },
    homepage: `${origin}`,
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
          websiteURL: `${origin}`,
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
            auth: { type: 'oauth', client: { mode: 'dcr' } },
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

Bei der Verbindung öffnet sich die Mailstack-Anmeldung. Melden Sie sich mit Ihrem bestehenden Mailstack-Konto an und wählen Sie anschließend ein aktives User-Token sowie die gewünschten Funktionen aus. Das OAuth-Token wird automatisch für diese Verbindung ausgestellt. Verwenden Sie nicht das statische Verwaltungstoken.

1. Erstellen Sie in der Verwaltungsoberfläche ein persönliches **User-Token**. Verwenden Sie nicht das statische Verwaltungstoken.
2. Installieren Sie das Plugin aus dem Marketplace. Melden Sie sich im OAuth-Fenster an und wählen Sie das User-Token und die gewünschten Funktionen aus.
3. Wenn Sie einen MCP-Client ohne OAuth-Unterstützung direkt verbinden möchten, setzen Sie das User-Token lokal als Umgebungsvariable \`${tokenEnvironmentName}\` und tragen Sie Folgendes in \`~/.codex/config.toml\` ein:

\`\`\`toml
[mcp_servers.${packageName}]
url = "${mcpUrl}"
bearer_token_env_var = "${tokenEnvironmentName}"
\`\`\`

Geben Sie das Token niemals im Chat oder als Befehlszeilenargument ein und speichern Sie es nicht in Plugin-Dateien oder \`config.toml\`. Wenn Sie den Wert verloren haben, erstellen Sie in der Verwaltung ein neues Token und widerrufen Sie das alte.

Das statische Verwaltungstoken wird ausschließlich für die Anmeldung auf \`${origin}\` benötigt. Es funktioniert nicht als MCP-Zugang.
`;
  const marketplaceUrl = new URL('/marketplace.git', origin).toString();
  const installGuide = `# ${pluginName} Plugin installieren

Der Marketplace dieser Instanz stellt das Plugin unter \`${marketplaceUrl}\` bereit. Das Plugin verwendet \`${mcpUrl}\` und enthält keine Zugangsdaten.

## Codex CLI

Fügen Sie den Marketplace hinzu und öffnen Sie anschließend den Plugin-Browser:

\`\`\`sh
codex plugin marketplace add ${marketplaceUrl}
\`\`\`

Öffnen Sie in Codex \`/plugins\` und installieren Sie ${pluginName} aus diesem Marketplace.

Beim Verbinden öffnet Codex die Mailstack-Anmeldung. Melden Sie sich mit Ihrem bestehenden Mailstack-Konto an, wählen Sie ein aktives User-Token und geben Sie die gewünschten Funktionen frei. Das Plugin erhält ein OAuth-Token, das an dieses Konto und User-Token gebunden ist.

## ChatGPT

Öffnen Sie in ChatGPT **Einstellungen → Apps → Erstellen** und fügen Sie einen benutzerdefinierten MCP-Server hinzu. Verwenden Sie die Server-Adresse \`${mcpUrl}\` und wählen Sie OAuth. Melden Sie sich im Mailstack-Fenster an und wählen Sie ein aktives User-Token sowie die gewünschten Funktionen aus. Scannen Sie die Tools und erstellen Sie die App; falls ChatGPT die Option anbietet, wählen Sie **Create as a plugin**. Die Verfügbarkeit hängt von den ChatGPT-Plan- und Workspace-Einstellungen für benutzerdefinierte MCP-Apps ab.
`;

  const files = [
    jsonEntry('plugin.json', pluginJson),
    { name: 'skills/setup/SKILL.md', data: Buffer.from(setupSkill, 'utf8') },
    { name: 'INSTALL.md', data: Buffer.from(installGuide, 'utf8') },
  ];
  if (options.includeMcpConfig !== false) files.splice(1, 0, jsonEntry('mcp.json', mcpJson));
  return files;
}

/** Creates a Codex marketplace catalog whose plugin source is the instance's Git endpoint. */
export function createMailstackMarketplace(marketplaceGitUrl: string, pluginName: string) {
  const packageName = pluginPackageName(pluginName);
  return {
    name: packageName,
    interface: { displayName: `${pluginName} Marketplace` },
    plugins: [{
      name: packageName,
      source: { source: 'url', url: marketplaceGitUrl },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    }],
  };
}

/** Generates the compatibility ZIP with endpoint metadata and credential setup guidance. */
export function createMailstackPluginArchive(mcpUrl: string, pluginName: string): Buffer {
  const packageName = pluginPackageName(pluginName);
  return zip(createMailstackPluginFiles(mcpUrl, pluginName).map((entry) => ({
    ...entry,
    name: `${packageName}/${entry.name}`,
  })));
}
