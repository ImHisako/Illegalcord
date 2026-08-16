# [<img src="./browser/Illegalcord.png" width="40" align="left" alt="Equicord">](https://github.com/Equicord/Equicord) Illegalcord

🌐 **Lingue / Languages:** [Italiano](README_IT.md) | [English](README.md)

Illegalcord è un fork open source di [Equicord](https://github.com/Equicord) e [Vencord](https://github.com/Vendicated/Vencord), con più di 300 plugin. È progettato per chi dà valore alla completa libertà di sviluppo, alla trasparenza, alla privacy e alla personalizzazione.

Nato inizialmente come progetto personale, Illegalcord ha guadagnato popolarità nel tempo, man mano che sempre più persone ne hanno scoperto e apprezzato le idee e le funzionalità. Il client mira a offrire comunicazioni più private attraverso il plugin SecurecordOpossum e consente di superare i limiti di caricamento di Discord utilizzando servizi esterni come [anon.li](https://anon.li/).

Se cerchi un client Discord che offra maggiore privacy e più libertà di utilizzo, Illegalcord potrebbe essere la scelta giusta per te. Include inoltre il supporto all'audio stereo e offre una qualità audio migliore rispetto a Lightcord, senza costi nascosti né componenti closed source. Il progetto è completamente open source.

> [!WARNING]
> Illegalcord viene talvolta etichettato come malware semplicemente perché non applica gli stessi limiti imposti da altri client modificati. Non affidarti a giudizi privi di verifiche: il progetto è completamente open source, quindi puoi leggere e controllare personalmente il codice. Se, dopo averlo esaminato, lo ritieni sicuro e adatto alle tue esigenze, sei libero di installarlo e usarlo.

Telegram e notizie: https://t.me/Illegalcord

Sito di Illegalcord: https://illegalcord.mintlify.site/

### Plugin Inclusi

I plugin inclusi possono essere trovati [qui](https://equicord.org/plugins).

### Plugin Aggiunti su Illegalcord
<details>
<summary>Clicca per vedere i plugin aggiunti a Illegalcord</summary>

- **Surveillance**: Dashboard PoC sperimentale per analizzare eventi Discord già visibili al client dell'utente. Destinata esclusivamente a ricerca, formazione e test autorizzati.
- **Kamidere Mutual Scanner**
- **kamidere PresenceLab**
- **Kamidere SendTrail**
- **FloeP2PService** | Basato sul servizio Floe.one, il miglior servizio di condivisione file P2P.
- **WebCord Hardened**
- **StereoInstaller** Più Metodi!
- **FakeMuteAndDeafen**
- **BetterMic**
- **BetterScreenshare**
- **Anon.li Drop** | Supera i limiti di Discord per la condivisione di file + Attenzione alla sicurezza e alla privacy https://anon.li/
- **StaffDetector**
- **BigFileUpload**
- **Stalker**
- **FastGifPicker**
- **MassMention**
- **WebRTCLeakPrevent**
- **MultiInstance**
- **Client Diagnostics**
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
- **Ottimizzazioni di Hisako**
- **SilentDelete**
- **LarpCord**
- **ScreenshareAlert**
- **CrashHandlerEnhanched**
- **SilentDelete**
- **VoiceBoard** | ( https://github.com/aleeeh07/vc-voiceBoard )
- **SilentEdit** | ( https://github.com/aurickk/SilentEdit-Vencord )
- **BoosterCount** ( https://github.com/Reathe/BoosterCount/tree/main )
- **Nitro Sniper**: | ( https://github.com/neoarz/NitroSniper/tree/main )
- **BadgeSelector** | ( https://github.com/002-sans/VencordPlugins/tree/b8c7c98a50c0700f7389b0484e5659fe5ec0f99e/BadgesSelector )
- **CustomStream** | ( https://github.com/MrTopQ/customStream-Vencord)
- **TypingFriends** | ( https://github.com/debxylen/Vencord/tree/main/src/plugins/typingFriends )
- **embeddedURLs** | ( https://github.com/ddadiani/Vencord-EmbeddedLinks/blob/main/src/plugins/embeddedURLs/index.ts )
- **GPU Binder** | ( https://github.com/UnClide/vencord-gpubinder )
- **stereoScreenshareAudio** | ( https://github.com/nerdwave-nick/Vencord-Stereo-Fix/blob/main/src/plugins/stereoScreenshareAudio/index.ts )
- **DiscordLock** | ( https://github.com/vejcowski/DiscordLock/tree/main )
- **Opsec Plugin** | ( https://github.com/ItzSolace/OpSec-Vencord/tree/main ) | (Abbiamo una versione diversa con supporto italiano)
- **PluginStars** | ( https://github.com/Nightwielder23/discord-plugin-stars )
- **ServerBadges** | ( https://github.com/TomFront/ServerBadges )
- **SilentCall** | ( https://github.com/yahyepanna/Silent-call )
- **SpatialAudio** ( https://github.com/onewhobridges/vc-spatial-audio/tree/main )

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
- [Nightcord](https://nightcord.ru/) Per l'idee & la Base di alcuni plugins.

## Dichiarazione di Non Responsabilità

Discord è un marchio di Discord Inc. ed è menzionato esclusivamente a scopo descrittivo.
La sua menzione non implica alcuna affiliazione o approvazione da parte di Discord Inc.
Vencord non è affiliato con Equicord o Illegalcord.

### Stato Legale, PoC dell'Intero Progetto e Uso Responsabile

> [!IMPORTANT]
> **Illegalcord nel suo complesso, inclusi tutti i plugin integrati e non soltanto OSINTToolkit, Surveillance e Stalker, è pubblicato come proof of concept (PoC) sperimentale.** Le finalità previste sono ricerca, formazione, interoperabilità, privacy, personalizzazione e test di sicurezza autorizzati. La qualifica di PoC descrive lo scopo previsto del progetto: non costituisce un'esenzione legale e non rende lecito ogni possibile utilizzo.

Illegalcord non viene presentato come malware né come software destinato a facilitare reati. Il nome del progetto e la presenza di funzionalità avanzate o dual use non determinano, da soli, lo stato legale del software. Nessun manutentore può tuttavia garantire che il client, ogni plugin o ogni utilizzo siano leciti in qualsiasi giurisdizione. La liceità dipende dalla funzione utilizzata, dalla condotta dell'utente, dall'autorizzazione o dal consenso, dai dati coinvolti, dalla legge applicabile e dalle regole della piattaforma. Questa sezione contiene informazioni generali e non costituisce consulenza legale.

Illegalcord deve essere utilizzato esclusivamente con account, sistemi, server, comunicazioni e dati propri o ai quali si è esplicitamente autorizzati ad accedere e che si è autorizzati ad analizzare. Il fatto che un'informazione sia pubblicamente accessibile non elimina automaticamente gli obblighi in materia di privacy e protezione dei dati. È vietato utilizzare Illegalcord per accessi o intercettazioni non autorizzati, acquisizione o condivisione di credenziali o token, elusione dei controlli di sicurezza o di età, spam, molestie, doxxing, atti persecutori, profilazione o raccolta di dati non autorizzata, frode, violazione del diritto d'autore o qualsiasi altra attività illegale o abusiva.

#### Privacy, archiviazione locale e servizi di terze parti

Illegalcord è un software client, ma non è corretto presumere che ogni operazione rimanga esclusivamente all'interno di Discord o che non venga trattato alcun dato personale. In base ai plugin e alle impostazioni attivati, il client può leggere dati già disponibili al client Discord, salvare localmente impostazioni, identificativi, log e anteprime facoltative dei messaggi oppure trasmettere a servizi indipendenti identificativi, termini di ricerca, file, metadati delle richieste, contenuti destinati a webhook o altri dati scelti dall'utente. Prima di attivare plugin che trattano o trasmettono dati è necessario consultare la [Privacy Policy del progetto](PRIVACY_POLICY.md).

**OSINTToolkit interagisce con servizi indipendenti di terze parti, inclusi CordCat e Breach.vip.** Le richieste possono comunicare l'identificativo Discord cercato o altri termini di ricerca e metadati tecnici come l'indirizzo IP dell'utente. CordCat dichiara di conservare informazioni sulle ricerche e sulle richieste secondo la propria informativa e di poter interrogare un aggregatore privato di dati provenienti da violazioni. Altri plugin facoltativi possono contattare servizi di caricamento, webhook, servizi CAPTCHA, database di contenuti o altre API. Tali fornitori applicano termini, informative, misure di sicurezza e periodi di conservazione propri; Illegalcord non controlla il loro trattamento e non può cancellare i dati da essi detenuti.

Prima di trasmettere dati personali a qualunque servizio, l'utente deve individuare una finalità lecita e specifica, determinare una base giuridica adeguata, informare gli interessati quando richiesto, ridurre al minimo i dati inviati, stabilire un periodo di conservazione proporzionato, proteggere i file locali e rispettare i diritti di accesso, opposizione, rettifica e cancellazione. Non devono essere trasmessi dati di minori, categorie particolari di dati, credenziali, comunicazioni private o informazioni provenienti da violazioni salvo che il trattamento sia strettamente necessario, consentito dalla legge e adeguatamente protetto. La disponibilità pubblica, l'etichetta OSINT o l'informativa di un servizio terzo non dimostrano da sole la liceità del riutilizzo. Non devono essere adottate decisioni che incidano significativamente su una persona basandosi esclusivamente su risultati OSINT o provenienti da violazioni non verificati. Prima dell'uso è necessario consultare la [Privacy Policy di CordCat](https://cord.cat/privacy/), i [Termini di CordCat](https://cord.cat/terms/) e le informative di ogni altro servizio. Illegalcord non certifica la loro conformità al GDPR né l'accuratezza, la liceità, l'attualità o la provenienza dei dati forniti.

#### Plugin sensibili e limiti di utilizzo penalmente rilevanti

Alcune funzioni integrate sono particolarmente sensibili, inclusi OSINTToolkit, Surveillance, Stalker, GhostSelfbot, MassMention, AutoModBypass, NsfwGateBypass, i logger di messaggi, gli strumenti relativi ai token, gli sniper, le automazioni degli account e plugin analoghi. Tra i casi collegati al token rientrano **GhostSelfbot** (può leggere facoltativamente il token dell'account Discord corrente e scriverlo nei file di configurazione e dei token di Ghost affinché il selfbot esterno avviato possa autenticarsi), **ClanSwitcher** (legge temporaneamente in memoria il token Discord corrente per autorizzare richieste dirette alle API Discord che cambiano il clan attivo), **BoosterCount/showBoostCounts** (legge temporaneamente il token per richiedere direttamente a Discord i dati sui booster di un server) e **NoDevtoolsWarning** (non recupera né trasmette direttamente il token, ma disattiva la protezione della console con cui Discord lo nasconde, aumentando il rischio di esposizione accidentale tramite gli strumenti per sviluppatori). Fanno parte del PoC sperimentale dell'intero progetto, ma questa qualifica non ne autorizza l'impiego contro altre persone o in violazione delle regole della piattaforma. Devono rimanere disattivati se l'utente non ne comprende il funzionamento o non dispone dell'autorizzazione e della base giuridica necessarie.

- Il monitoraggio e la registrazione devono essere utilizzati soltanto sul proprio account o in un contesto di moderazione, ricerca o sicurezza espressamente autorizzato. Devono essere raccolti solo gli eventi necessari, evitando le anteprime dei messaggi salvo necessità, limitando gli accessi, definendo una conservazione breve e cancellando in modo sicuro i log esportati quando non servono più. È vietato usarli per seguire, intimidire, profilare, esporre o molestare una persona.
- È vietato ottenere, importare, utilizzare, esportare, pubblicare o trasmettere token, password, sessioni, chiavi API o credenziali di webhook appartenenti ad altri. Anche il proprio token Discord è un segreto ad alto rischio: non deve essere condiviso e non deve essere attivata una funzione che lo scrive su file senza accettarne consapevolmente i rischi di sicurezza e per l'account.
- Selfbot e automazioni non devono essere utilizzati per spam, menzioni massive, scraping, elusione dei limiti, acquisizione sleale di benefici, impersonificazione o aggiramento di moderazione, sicurezza, età, accessi o controlli sui contenuti. L'autorizzazione ai test deve provenire dal titolare dell'account o del sistema interessato e non prevale sulle regole di Discord.
- I dati restituiti da servizi OSINT o relativi a violazioni non devono essere considerati fatti verificati né utilizzati per stalking, attacchi alle credenziali, discriminazione, accuse pubbliche o decisioni riguardanti lavoro, accesso, reputazione, sicurezza o diritti.

In questa sezione, “token” non indica sempre il token dell'account Discord. FileUpload utilizza credenziali dei servizi di caricamento configurati dall'utente, come Zipline o Nest; Anon.li Drop utilizza una chiave API di Anon.li; YMusicSync utilizza un token OAuth di Yandex Music; plugin come NitroSniper, ReviewDB, Decor, SongSpotlight, Streaks, ThemeLibrary o TriviaAI possono utilizzare token API, OAuth o di sessione specifici dei rispettivi servizi. Queste credenziali non consentono di accedere all'account Discord, salvo che un servizio o un plugin utilizzi espressamente il token dell'account Discord, ma devono comunque essere protette e possono essere trasmesse al fornitore indicato per l'autenticazione. L'elenco descrive le integrazioni presenti al momento della redazione e deve essere verificato nuovamente quando i plugin cambiano.

La responsabilità penale dipende dalla condotta concreta, dall'intento, dall'autorizzazione e dalle circostanze; il semplice nome o la presenza di una funzione dual use non costituiscono automaticamente un reato. Tuttavia, l'introduzione abusiva in un sistema protetto o la permanenza contro la volontà del titolare può rientrare nell'articolo 615-ter del Codice penale; il procacciamento, la detenzione, la produzione o la diffusione illeciti di credenziali finalizzati a un uso illecito possono rientrare nell'articolo 615-quater; l'intercettazione, l'impedimento o l'interruzione fraudolenti di comunicazioni informatiche possono rientrare nell'articolo 617-quater; minacce o molestie reiterate che producono gli eventi previsti dalla legge possono rientrare nell'articolo 612-bis. L'uso del proprio account o la ricezione di eventi normalmente destinati al proprio client non equivalgono automaticamente a tali reati, ma possono comunque violare contratti, normativa privacy o altre regole. Soltanto le autorità e i giudici competenti possono stabilire se un caso concreto integri una fattispecie di reato. Il testo consolidato vigente è disponibile su [Normattiva](https://www.normattiva.it/eli/id/1930/10/26/030U1398/CONSOLIDATED).

Tra le fonti ufficiali rilevanti rientrano:

- La [licenza GNU GPL-3.0-or-later](LICENSE), che disciplina copia, modifica e distribuzione del progetto, ma non autorizza condotte illecite.
- Il [Regolamento generale sulla protezione dei dati dell'UE](https://eur-lex.europa.eu/eli/reg/2016/679/oj), in particolare gli articoli 4, 5, 6, 12-14, 25 e 32 relativi a dati personali, liceità, trasparenza, minimizzazione, protezione dei dati fin dalla progettazione e sicurezza.
- La [guida del Garante per la protezione dei dati personali sui principi fondamentali del trattamento](https://www.garanteprivacy.it/home/principi-fondamentali-del-trattamento).
- Il [Codice penale italiano su Normattiva](https://www.normattiva.it/eli/id/1930/10/26/030U1398/CONSOLIDATED), inclusi, quando applicabili alla condotta concreta, gli articoli 612-bis, 615-ter, 615-quater e 617-quater in materia di atti persecutori, accesso abusivo a sistemi informatici, codici di accesso e intercettazione illecita di comunicazioni informatiche.
- I [Termini di Servizio di Discord](https://discord.com/terms), la [Policy sulla manipolazione della piattaforma](https://discord.com/safety/platform-manipulation-policy-explainer-oct-2023) e la [policy ufficiale sui self-bot](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots).

Discord vieta le modifiche al client e l'automazione di normali account utente al di fuori della propria API per bot. Questa violazione contrattuale o delle regole della piattaforma è distinta da una valutazione penalistica, ma può comunque causare la sospensione o la chiusura dell'account. I manutentori e i contributori non approvano alcun uso illegale e non possono assumersi responsabilità per l'uso improprio da parte di terzi.

## Ringraziamenti speciali

Siamo orgogliosi di collaborare con [Nightcord](https://nightcord.st/).
Le loro idee, le loro scelte di progettazione e parti del loro codice sono state integrate direttamente nella filosofia di sviluppo di Illegalcord, influenzando diversi plugin e funzionalità.
Questa collaborazione è stata ben più di un semplice nome: ha rappresentato un contributo concreto alla direzione e alla qualità di questo client.

> [!WARNING]
> **Il nome Illegalcord non rende il client illegale di per sé.** La parola **"Illegal"** fa parte solo del nome del progetto e non determina lo stato legale del software.
> Il nome richiama l'idea di un client Discord senza le limitazioni e le regole tipicamente imposte da altri client mod, in modo simile alla filosofia di personalizzazione di Equicord e Vencord.
> Tuttavia, l'uso di client modificati può comunque violare i Termini di Servizio di Discord, quindi va fatto con consapevolezza.
> Gli utilizzi illeciti non rientrano nelle finalità previste dal progetto. La responsabilità è determinata dalla legge applicabile e non può essere esclusa semplicemente tramite questo disclaimer.

<details>
<summary>Usare Illegalcord viola i termini di servizio di Discord</summary>

Le modifiche al client sono contro i Termini di Servizio di Discord.

Discord vieta espressamente le modifiche al client e i self-bot. Nella pratica, l'applicazione di sanzioni per il normale utilizzo non abusivo di client modificati è generalmente considerata poco frequente, quindi la maggior parte degli utenti ritiene basso il rischio di ban. Il rischio non è tuttavia pari a zero e il progetto non può garantire che un account non subisca conseguenze. I plugin che automatizzano account, generano spam, aggirano misure di sicurezza o consentono comportamenti abusivi comportano un rischio sensibilmente maggiore.

Indipendentemente da ciò, se il tuo account è essenziale per te e la sua disabilitazione sarebbe un disastro, probabilmente dovresti evitare di usare mod client (non solo Equicord), giusto per essere al sicuro.

Inoltre, assicurati di non pubblicare screenshot con Illegalcord in un server dove potresti essere bannato per questo.

</details>
