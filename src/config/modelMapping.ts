import fs from 'fs';
import path from 'path';

interface ModelMappingConfig {
  [originalModel: string]: string;
}

let modelMapping: ModelMappingConfig = {};
let configLoaded = false;

const CONFIG_FILE_PATH = process.env.MODEL_MAPPING_CONFIG || path.join(process.cwd(), 'model-mapping.json');

export function loadModelMapping(configPath?: string): void {
  if (configLoaded) {
    return;
  }

  const configFilePath = configPath || CONFIG_FILE_PATH;

  try {
    if (fs.existsSync(configFilePath)) {
      const configContent = fs.readFileSync(configFilePath, 'utf-8');
      const config = JSON.parse(configContent);
      
      if (typeof config === 'object' && config !== null) {
        modelMapping = config;
        console.log(`✅ Loaded model mapping configuration from ${configFilePath}`);
        console.log(`📋 Model mappings: ${Object.keys(modelMapping).length} mappings configured`);
        
        if (Object.keys(modelMapping).length > 0) {
          Object.entries(modelMapping).forEach(([original, mapped]) => {
            console.log(`   • ${original} → ${mapped}`);
          });
        }
      }
    } else {
      console.log(`ℹ️  No model mapping configuration found at ${configFilePath}`);
    }
  } catch (error) {
    console.error(`❌ Failed to load model mapping configuration: ${error}`);
  }
  
  configLoaded = true;
}

export function getMappedModelName(originalModel: string): string {
  return modelMapping[originalModel] || originalModel;
}

export function getOriginalModelName(mappedModel: string): string | undefined {
  return Object.keys(modelMapping).find(key => modelMapping[key] === mappedModel);
}

export function getAllMappings(): ModelMappingConfig {
  return { ...modelMapping };
}

export function hasMappings(): boolean {
  return Object.keys(modelMapping).length > 0;
}