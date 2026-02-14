# IGP - Illegalcord PGP Encryption Plugin

IGP (Illegalcord GPG/Pgp) is a powerful encryption plugin for Illegalcord that enables end-to-end encrypted messaging using PGP (Pretty Good Privacy) encryption.

## Features

- **End-to-end encryption**: Messages are encrypted on your device and can only be decrypted by the intended recipient
- **Easy message encryption**: Encrypt messages directly from the chat bar with a simple button click
- **Command-based operations**: Use `/pgp` commands for advanced operations
- **Key management**: Import, export, and manage PGP keys for contacts
- **Message signing**: Sign messages to verify authenticity
- **Key verification**: Verify the authenticity of received messages
- **Keyserver integration**: Search for public keys on popular keyservers

## Setup

### Generating Keys

To get started, you'll need to generate a PGP key pair:

1. Open chat and type `/pgp generate`
2. Enter your name, email, and passphrase when prompted
3. Select either ECC (recommended) or RSA 4096 key type
4. Your keys will be automatically saved in the plugin settings

### Alternative: Manual Key Setup

If you already have PGP keys:

1. Go to Illegalcord settings
2. Find the IGP plugin settings
3. Paste your private and public keys in the appropriate fields

## Usage

### Encrypting Messages

There are two ways to encrypt messages:

#### Method 1: Chat Bar Button
1. Navigate to a direct message conversation
2. Click the lock icon next to the message input box
3. Enter your message and the recipient's public key
4. Click "Send" to encrypt and paste the message in the chat

#### Method 2: Command
1. Type `/pgp encrypt`
2. Enter your message and select the recipient
3. The encrypted message will be sent automatically

### Decrypting Messages

When you receive an encrypted message:

1. Click the "Decrypt Message" button that appears in the message options
2. The decrypted message will appear in a modal window
3. You'll see verification status (whether the signature is valid)

### Sharing Your Public Key

To share your public key with contacts:

1. Type `/pgp sharekey` in any chat
2. The command will return your public key in the chat

### Adding Contact Keys

To add a contact's public key:

1. Get their public key
2. Type `/pgp import`
3. Paste their public key and select their user account
4. Their key will be saved for future encryption

### Signing Messages

To sign a message (proving it came from you):

1. Type `/pgp sign`
2. Enter your message
3. The signed message will be returned

### Verifying Signed Messages

To verify a signed message:

1. Type `/pgp verify`
2. Paste the signed message
3. The command will tell you if the signature is valid

### Searching for Keys

To search for someone's public key on keyservers:

1. Type `/pgp search`
2. Enter their email address or key ID
3. If found, you can import the key using `/pgp import`

### Getting Your Key Fingerprint

To see your key fingerprint:

1. Type `/pgp fingerprint`
2. The command will return your key's fingerprint for verification

## Commands Reference

| Command | Description |
|--------|-------------|
| `/pgp encrypt` | Encrypt a message for a specific user |
| `/pgp decrypt` | Decrypt a PGP message |
| `/pgp sign` | Sign a message with your private key |
| `/pgp verify` | Verify a signed message |
| `/pgp sharekey` | Share your public key |
| `/pgp fingerprint` | Show your key fingerprint |
| `/pgp generate` | Generate a new PGP key pair |
| `/pgp import` | Import a contact's public key |
| `/pgp search` | Search for a public key on keyservers |

## Security Notes

- Keep your private key and passphrase secure and never share them
- Always verify key fingerprints with contacts through a trusted channel
- The plugin loads OpenPGP.js from CDN when needed
- Messages are encrypted locally before being sent

## About the Plugin

IGP was built specifically for the Illegalcord Discord mod, extending the Vencord plugin architecture. The plugin leverages the OpenPGP.js library to provide robust encryption capabilities directly within Discord.

### Technical Implementation

- **Encryption Library**: Uses OpenPGP.js loaded from CDN
- **UI Components**: Built with Discord's native component system
- **Storage**: Uses Illegalcord's DataStore API for key management
- **Commands**: Integrated with Illegalcord's command system
- **UI Integration**: Adds buttons to chat bar and message popovers

### Key Features Implemented

1. **Asynchronous Loading**: OpenPGP.js is loaded dynamically when needed
2. **Dual CDN Fallback**: Uses both unpkg and jsDelivr CDNs for reliability
3. **Key Management**: Comprehensive system for storing and retrieving contact keys
4. **Message Formatting**: Proper handling of message formatting during encryption
5. **Error Handling**: Comprehensive error handling with user-friendly notifications
6. **Key Verification**: Signature verification to ensure message integrity

The plugin seamlessly integrates with Discord's interface, providing a smooth and intuitive experience for secure communications.