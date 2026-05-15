# [<img src="./browser/icon.png" width="40" align="left" alt="Equicord">](https://github.com/Equicord/Equicord) Illegalcord

🌐 **Lingue / Languages:** [Italiano](README_IT.md) | [English](README.md)

Illegalcord è un fork di [Equicord](https://github.com/Equicord) & [Vencord](https://github.com/Vendicated/Vencord), con oltre 300+ plugin.
Un client open-source creato per chi crede nella libertà assoluta di sviluppo.
Un client open source pensato per chi crede nella libertà assoluta di sviluppo.
Possiamo considerare questo client un'alternativa affidabile a Lightcord, poiché Illegalcord è un progetto gratuito e open source che supporta l'audio stereo.
Non ti fidi di Lightcord? Sei nel posto giusto.
Vuoi sfruttare le API di Discord? Cerchi un client Discord senza regole? Sei nel posto giusto.
Vuoi chattare in privato su Discord? Il plugin “Securecord Opossum” è quello che fa per te.
Vuoi ottenere codici Nitro per avere Nitro gratis? Abbiamo un plugin integrato per ottenere Nitro gratis: smetti di pagare per Nitro a partire da ora.

Telegram x News: https://t.me/Illegalcord

### Metodo Stereo
Download: https://github.com/ProdHallow/Discord-Stereo-Installer/blob/main/Stereo%20Installer.bat

### Plugin Inclusi

I plugin inclusi possono essere trovati [qui](https://equicord.org/plugins).

### Plugin Aggiunti su Illegalcord
<details>
<summary>Clicca per vedere i plugin aggiunti a Illegalcord</summary>

- **Surveillance** il nuovo miglior plugin di Illegalcord che ti permette di poter fare Osint / fare SORVEGLIANZA DI MASSA su Persone e server discord. 
- **Kamidere Mutual Scanner**
- **kamidere PresenceLab**
- **Kamidere SendTrail**
- **WebCord Hardened**
- **Nitro Sniper**: | (https://github.com/neoarz/NitroSniper/tree/main)
- **FakeMuteAndDeafen**
- **BetterMic**
- **BetterScreenshare**
- **StaffDetector**
- **BigFileUpload**
- **Stalker**
- **MassMention**
- **WebRTCLeakPrevent**
- **AutoModBypass**
- **ServerCloner**
- **Securecord** | (AES 256 sui messaggi)
- **Securecord Opossum Blazing Edition** | BlazingOpossum, dimensione blocco + IV + MAC Tag 128 bit, chiave 256 bit. Basato su istruzioni AVX2, algoritmo crittografico simmetrico post-quantistico ad alte prestazioni. Avanzato e moderno. | https://github.com/ZygoteCode/BlazingOpossum)
- **GhostSelfbot** | Avvia Ghost Selfbot (exe o source) con auto-configurazione, installer requisiti Python e gestione token | https://ghostt.cc/
- **IGP** (plugin pgp)
- **Mullvad DNS Over Discord** (Privacy e Sicurezza)
- **CustomDNS**
- **DisableAnimations**
- **NoMirroredCam**
- **OpenOptimizer**
- **Vcjumkoptimizer**
- **2FA Hider**
- **Follow User** (Senza controllo amici, Segui tutti senza limiti)
- **DontLimitMe**
- **GateawayLogger**
- **InviteDefaults**
- **OsintToolKit**
- **Ottimizzazioni di Hisako** (Attualmente instabile)
- **BoosterCount** (https://github.com/Reathe/BoosterCount/tree/main)
- **BadgeSelector** | (https://github.com/002-sans/VencordPlugins/tree/b8c7c98a50c0700f7389b0484e5659fe5ec0f99e/BadgesSelector)
- **CustomStream** | (https://github.com/MrTopQ/customStream-Vencord)
- **TypingFriends** | (https://github.com/debxylen/Vencord/tree/main/src/plugins/typingFriends)
- **SilentDelete** | (https://github.com/aurickk/SilentDelete-Vencord)
- **embeddedURLs** | (https://github.com/ddadiani/Vencord-EmbeddedLinks/blob/main/src/plugins/embeddedURLs/index.ts)
- **GPU Binder** | (https://github.com/UnClide/vencord-gpubinder)
- **stereoScreenshareAudio** | (https://github.com/nerdwave-nick/Vencord-Stereo-Fix/blob/main/src/plugins/stereoScreenshareAudio/index.ts)
- **DiscordLock** | (https://github.com/vejcowski/DiscordLock/tree/main)
- **KeepGifPickerOpen** | (https://github.com/pacxwheaa/KeepGifPickerOpen/tree/main)
- **Opsec Plugin** | (https://github.com/ItzSolace/OpSec-Vencord/tree/main) | (Abbiamo una versione diversa con supporto italiano)
- **DecibelLimiter** | (https://github.com/BashOnZsh/Bashcord/tree/main/src/userplugins/decibelLimiter)
- **CrashHandlerEnhanched** | (https://github.com/Mifu999/Equicord-Userplugins/tree/main/userplugins/crashHandlerEnhanced)

</details>

Illegalcord ha le sue badge personali btw

## Installare Illegalcord

### Dipendenze

Sono richiesti [Git](https://git-scm.com/download) e [Node.JS LTS](https://nodejs.dev/en/).

Installa `pnpm`:

> :exclamation: Questo comando potrebbe dover essere eseguito come amministratore/root a seconda del tuo sistema, e potresti dover chiudere e riaprire il terminale affinché pnpm sia nel tuo PATH.

```shell
npm i -g pnpm
```

> :exclamation: **IMPORTANTE** Assicurati di non usare un terminale amministratore/root da qui in poi. **Rovinerà** la tua installazione di Discord/Illegalcord e molto probabilmente dovrai reinstallare.

Se stai usando il BAT per installare il Client e hai l'errore che l'esecuzione di scripts è disabilitato nel vostro sistema. useguite da powershell con amministratore :
```shell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

Clona Illegalcord:

```shell
git clone https://github.com/ImHisako/Illegalcord
cd Illegalcord
```

Installa le dipendenze:

```shell
pnpm install --frozen-lockfile
```

Compila Illegalcord:

```shell
pnpm build
```

Inietta Illegalcord nel tuo client desktop:

```shell
pnpm inject
```

Compila Illegalcord per il web:

```shell
pnpm buildWeb
```

Dopo aver compilato l'estensione web di Illegalcord, individua il file ZIP appropriato nella directory `dist` e segui la guida del tuo browser per installare estensioni personalizzate, se supportato.

Nota: Il file zip dell'estensione Firefox richiede Firefox per sviluppatori

## Crediti

- [thororen1234](https://github.com/thororen1234) per aver creato [Equicord](https://github.com/Equicord)
- [Vendicated](https://github.com/Vendicated) per aver creato [Vencord](https://github.com/Vendicated/Vencord)
- [verticalsync](https://github.com/verticalsync) per aver creato [Suncord](https://github.com/verticalsync/Suncord)

## Dichiarazione di Non Responsabilità

Discord è un marchio di Discord Inc., e menzionato esclusivamente a scopo descrittivo.
Menzionarlo non implica alcuna affiliazione o approvazione da parte di Discord Inc.
Vencord non è connesso a Equicord & Illegalcord e come tali.

<details>
<summary>Usare Illegalcord viola i termini di servizio di Discord</summary>

Le modifiche al client sono contro i Termini di Servizio di Discord.

Tuttavia, Discord è piuttosto indifferente nei loro confronti e non ci sono casi noti di utenti bannati per l'uso di mod client! Quindi dovresti stare generalmente bene se non usi plugin che implementano comportamenti abusivi. Ma non preoccuparti, tutti i plugin integrati sono sicuri da usare!

Indipendentemente da ciò, se il tuo account è essenziale per te e la sua disabilitazione sarebbe un disastro, probabilmente dovresti evitare di usare mod client (non solo Equicord), giusto per essere al sicuro.

Inoltre, assicurati di non pubblicare screenshot con Illegalcord in un server dove potresti essere bannato per questo.

</details>
