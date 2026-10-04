import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmClient, createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
const workspace=mkdtempSync(join(tmpdir(),'sdk-owned-settings-'));
const pmRoot=join(workspace,'.agents','pm');
try {
 const client=new PmClient({cwd:workspace,pmRoot,noExtensions:true});
 await client.init();
 const settingsPath=join(pmRoot,'settings.json');
 const initial=JSON.parse(readFileSync(settingsPath,'utf8'));
 initial.governance={preset:'default',certification_leftover:true};
 writeFileSync(settingsPath,JSON.stringify(initial,null,2)+'\n');
 const sdk=createExtensionCommandSdk(pmRoot,client,'certification-synthetic');
 let callbackHadLeftover;
 const result=await sdk.mutateWorkspaceSettings({operationId:'replace-owned-governance',includePreview:true,mutate(current){
  callbackHadLeftover=Object.hasOwn(current.governance,'certification_leftover');
  return {...current,governance:{preset:'minimal'}};
 }});
 const actual=JSON.parse(readFileSync(settingsPath,'utf8'));
 console.log(JSON.stringify({cli:'2026.10.4',callbackHadLeftover,receiptChanged:result.changed,previewHasLeftover:Object.hasOwn(result.preview.governance,'certification_leftover'),persistedLeftover:actual.governance.certification_leftover}));
 assert.equal(actual.governance.certification_leftover,undefined,'Complete-next-tree mutation must remove an omitted owned-subtree key');
} finally {rmSync(workspace,{recursive:true,force:true});}
