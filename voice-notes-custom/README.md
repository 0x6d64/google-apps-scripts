# Custom Voice Notes script
Based on [https://github.com/james-lindstrom/voice-notes](https://github.com/dhrme/pebble-apps/tree/main/voice-notes)

It incorporates the [sheetpost](../sheetpost) features.

**Why**: Calling one Apps Script from another gave me trouble with 
permissions.

## Design notes

- the script shall be able to process the native voice note requests
- the script shall store the preshared secret in the script properties (not 
  in a varible in the script)
- the script shall be able to process requests just like the sheetpost script
- the script shall create an entry in the note sheet if the "status" prefix 
  is used. in this case the type of note shall be set to a value that can be 
  configured in the script (variable), default is "pebble"
