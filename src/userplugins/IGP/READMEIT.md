# IGP - Plugin di Crittografia PGP per Illegalcord

IGP (Illegalcord GPG/Pgp) è un potente plugin di crittografia per Illegalcord che permette la messaggistica cifrata end-to-end utilizzando la crittografia PGP (Pretty Good Privacy).

## Funzionalità

- **Crittografia end-to-end**: I messaggi sono crittografati sul tuo dispositivo e possono essere decrittografati solo dal destinatario previsto
- **Crittografia messaggi facile**: Critta i messaggi direttamente dalla barra di chat con un semplice click
- **Operazioni basate su comandi**: Usa i comandi `/pgp` per operazioni avanzate
- **Gestione chiavi**: Importa, esporta e gestisci le chiavi PGP dei contatti
- **Firma messaggi**: Firma i messaggi per verificarne l'autenticità
- **Verifica messaggi**: Verifica l'autenticità dei messaggi ricevuti
- **Integrazione keyserver**: Cerca chiavi pubbliche sui keyserver popolari

## Installazione

1. Posiziona la cartella del plugin nella directory `userplugins` di Illegalcord:
   ```
   Illegalcord/src/userplugins/igp/
   ```

2. Ricostruisci Illegalcord per includere il plugin

3. Abilita il plugin nelle impostazioni di Illegalcord

## Configurazione

### Generazione Chiavi

Per iniziare, devi generare una coppia di chiavi PGP:

1. Apri la chat e digita `/pgp generate`
2. Inserisci il tuo nome, email e passphrase quando richiesto
3. Seleziona il tipo di chiave ECC (consigliato) o RSA 4096
4. Le tue chiavi saranno salvate automaticamente nelle impostazioni del plugin

### Alternativa: Configurazione Manuale Chiavi

Se hai già chiavi PGP:

1. Vai alle impostazioni di Illegalcord
2. Trova le impostazioni del plugin IGP
3. Incolla le tue chiavi privata e pubblica nei campi appropriati

## Utilizzo

### Crittare Messaggi

Ci sono due modi per crittare i messaggi:

#### Metodo 1: Bottone Barra di Chat
1. Naviga in una conversazione di messaggi diretti
2. Clicca l'icona del lucchetto vicino alla casella di input del messaggio
3. Inserisci il tuo messaggio e la chiave pubblica del destinatario
4. Clicca "Invia" per crittare e incollare il messaggio in chat

#### Metodo 2: Comando
1. Digita `/pgp encrypt`
2. Inserisci il tuo messaggio e seleziona il destinatario
3. Il messaggio crittato verrà inviato automaticamente

### Decrittare Messaggi

Quando ricevi un messaggio crittato:

1. Clicca il bottone "Decrittare Messaggio" che appare nelle opzioni del messaggio
2. Il messaggio decrittato apparirà in una finestra modale
3. Vedrai lo stato di verifica (se la firma è valida)

### Condivisione della Tua Chiave Pubblica

Per condividere la tua chiave pubblica con i contatti:

1. Digita `/pgp sharekey` in qualsiasi chat
2. Il comando restituirà la tua chiave pubblica in chat

### Aggiunta Chiavi Contatti

Per aggiungere la chiave pubblica di un contatto:

1. Ottieni la loro chiave pubblica
2. Digita `/pgp import`
3. Incolla la loro chiave pubblica e seleziona il loro account utente
4. La loro chiave verrà salvata per futura crittografia

### Firma Messaggi

Per firmare un messaggio (provare che proviene da te):

1. Digita `/pgp sign`
2. Inserisci il tuo messaggio
3. Il messaggio firmato verrà restituito

### Verifica Messaggi Firmati

Per verificare un messaggio firmato:

1. Digita `/pgp verify`
2. Incolla il messaggio firmato
3. Il comando ti dirà se la firma è valida

### Ricerca Chiavi

Per cercare la chiave pubblica di qualcuno sui keyserver:

1. Digita `/pgp search`
2. Inserisci il loro indirizzo email o ID chiave
3. Se trovata, puoi importare la chiave usando `/pgp import`

### Ottenere la Tua Impronta Digitale

Per vedere l'impronta digitale della tua chiave:

1. Digita `/pgp fingerprint`
2. Il comando restituirà l'impronta digitale della tua chiave per verifica

## Riferimento Comandi

| Comando | Descrizione |
|--------|-------------|
| `/pgp encrypt` | Critta un messaggio per un utente specifico |
| `/pgp decrypt` | Decritta un messaggio PGP |
| `/pgp sign` | Firma un messaggio con la tua chiave privata |
| `/pgp verify` | Verifica un messaggio firmato |
| `/pgp sharekey` | Condividi la tua chiave pubblica |
| `/pgp fingerprint` | Mostra l'impronta digitale della tua chiave |
| `/pgp generate` | Genera una nuova coppia di chiavi PGP |
| `/pgp import` | Importa la chiave pubblica di un contatto |
| `/pgp search` | Cerca una chiave pubblica sui keyserver |

## Note di Sicurezza

- Mantieni la tua chiave privata e passphrase sicure e non condividerle mai
- Verifica sempre le impronte digitali delle chiavi con i contatti attraverso un canale affidabile
- Il plugin carica OpenPGP.js da CDN quando necessario
- I messaggi sono crittati localmente prima dell'invio

## Informazioni sul Plugin

IGP è stato sviluppato specificamente per la mod di Discord Illegalcord, estendendo l'architettura dei plugin Vencord. Il plugin sfrutta la libreria OpenPGP.js per fornire solide capacità di crittografia direttamente all'interno di Discord.

### Implementazione Tecnica

- **Libreria di crittografia**: Usa OpenPGP.js caricato da CDN
- **Componenti UI**: Costruito con il sistema di componenti nativi di Discord
- **Archiviazione**: Usa l'API DataStore di Illegalcord per la gestione delle chiavi
- **Comandi**: Integrato con il sistema di comandi di Illegalcord
- **Integrazione UI**: Aggiunge bottoni alla barra di chat e ai popup dei messaggi

### Funzionalità Chiave Implementate

1. **Caricamento Asincrono**: OpenPGP.js viene caricato dinamicamente quando necessario
2. **Fallback CDN Doppio**: Usa sia le CDN unpkg che jsDelivr per affidabilità
3. **Gestione Chiavi**: Sistema completo per memorizzare e recuperare le chiavi dei contatti
4. **Formattazione Messaggi**: Adeguata gestione della formattazione dei messaggi durante la crittografia
5. **Gestione Errori**: Gestione completa degli errori con notifiche amichevoli per l'utente
6. **Verifica Chiavi**: Verifica delle firme per garantire l'integrità del messaggio

Il plugin si integra perfettamente con l'interfaccia di Discord, fornendo un'esperienza fluida e intuitiva per le comunicazioni sicure.