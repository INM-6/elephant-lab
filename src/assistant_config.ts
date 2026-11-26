import { JSONExt } from '@lumino/coreutils';
import type { JSONObject, ReadonlyPartialJSONValue } from '@lumino/coreutils';

export const ASSISTANT_CONFIGURATION_FIELDS = ['apiUrl', 'apiKey', 'model'] as const;
export type AssistantConfigurationField = typeof ASSISTANT_CONFIGURATION_FIELDS[number];

export type AssistantSettingSource = 'value' | 'environment';

export interface AssistantFieldSetting extends JSONObject {
    source: AssistantSettingSource;
    value: string;
}

export interface AssistantConfiguration extends JSONObject {
    apiUrl: AssistantFieldSetting;
    apiKey: AssistantFieldSetting;
    model: AssistantFieldSetting;
}

function parseField(value: ReadonlyPartialJSONValue | undefined): AssistantFieldSetting {
    if (value === undefined) {
        return { source: 'value', value: '' };
    }
    if (!JSONExt.isObject(value)) {
        throw new Error('Each saved assistant setting must be an object.');
    }

    const source = value.source;
    const fieldValue = value.value;
    if (source !== 'value' && source !== 'environment') {
        throw new Error('Assistant setting source must be a direct value or environment variable.');
    }
    if (fieldValue !== undefined && typeof fieldValue !== 'string') {
        throw new Error('Assistant setting values must be strings.');
    }

    return {
        source,
        value: fieldValue ?? ''
    };
}

export function parseAssistantConfiguration(
    value: ReadonlyPartialJSONValue | undefined
): AssistantConfiguration {
    if (value === undefined || value === null) {
        return {
            apiUrl: { source: 'value', value: '' },
            apiKey: { source: 'value', value: '' },
            model: { source: 'value', value: '' }
        };
    }
    if (!JSONExt.isObject(value)) {
        throw new Error('Saved assistant settings must be an object.');
    }

    return {
        apiUrl: parseField(value.apiUrl),
        apiKey: parseField(value.apiKey),
        model: parseField(value.model)
    };
}
