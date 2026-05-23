# OpSec

Autocorrect leggero per i messaggi in uscita. Corregge errori comuni in inglese e italiano senza toccare link, mention, emoji custom o blocchi di codice.

## Cosa fa

- Corregge contrazioni inglesi come `dont`, `cant`, `youre`.
- Corregge refusi inglesi comuni come `teh`, `recieve`, `seperate`.
- Corregge molti errori italiani comuni come `perche`, `cioe`, `qual'è`, `pultroppo`, `sopratutto`, `qnd`, `cmq`, `xke`.
- Normalizza spazi e punteggiatura ripetuta.
- Capitalizza l'inizio delle frasi.
- Supporta sostituzioni personalizzate in formato `parola=sostituzione`.
- Può usare il messaggio a cui stai rispondendo per correggere typo molto vicini, ma solo se abiliti l'opzione.

## Sicurezza

OpSec evita di modificare:

- URL.
- Mention e `@everyone` / `@here`.
- Emoji custom.
- Inline code e code block.
- Slash commands.

Le correzioni aggressive sono disattivate di default. L'espansione dello slang, per esempio `cmq` o `idk`, resta configurabile.

## Impostazioni

| Setting | Default | Descrizione |
| --- | --- | --- |
| `enable` | `true` | Abilita il plugin. |
| `enableEnglish` | `true` | Abilita correzioni inglesi. |
| `enableItalian` | `true` | Abilita correzioni italiane. |
| `fixContractions` | `true` | Sistema apostrofi mancanti. |
| `fixSpelling` | `true` | Corregge refusi comuni. |
| `expandSlang` | `false` | Espande abbreviazioni e slang. |
| `fixSpaces` | `true` | Normalizza spazi extra. |
| `fixPunctuation` | `true` | Riduce punteggiatura ripetuta. |
| `fixCapitalization` | `true` | Capitalizza inizio frase. |
| `addPeriod` | `false` | Aggiunge il punto finale. |
| `contextualCorrection` | `false` | Usa la reply come contesto per typo cauti. |
| `customReplacements` | vuoto | Sostituzioni custom, una per riga. |
