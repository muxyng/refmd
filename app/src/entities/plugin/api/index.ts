import {
  listRecords as apiListRecords,
  pluginsCreateRecord as apiPluginsCreateRecord,
  pluginsDeleteRecord as apiPluginsDeleteRecord,
  pluginsExecAction as apiPluginsExecAction,
  pluginsGetKv as apiPluginsGetKv,
  pluginsGetManifest as apiPluginsGetManifest,
  pluginsInstallFromUrl as apiPluginsInstallFromUrl,
  pluginsPutKv as apiPluginsPutKv,
  pluginsUninstall as apiPluginsUninstall,
  pluginsUpdateRecord as apiPluginsUpdateRecord,
} from '@/shared/api'
import type { ManifestItem as ClientManifestItem } from '@/shared/api/client'

export type PluginManifestItem = ClientManifestItem

export const pluginKeys = {
  manifest: () => ['plugins', 'manifest'] as const,
}

export const pluginManifestQuery = (token?: string | null) => ({
  queryKey: token ? [...pluginKeys.manifest(), token] : pluginKeys.manifest(),
  queryFn: () => getPluginManifest(token ?? undefined),
  staleTime: 60_000,
})

export async function getPluginManifest(token?: string): Promise<PluginManifestItem[]> {
  return apiPluginsGetManifest({ token })
}

export async function execPluginAction(
  pluginId: string,
  action: string,
  payload: Record<string, unknown> | undefined,
  token?: string,
) {
  return apiPluginsExecAction({
    plugin: pluginId,
    action,
    requestBody: { payload },
    token,
  })
}

export async function listPluginRecords(
  pluginId: string,
  docId: string,
  kind: string,
  token?: string,
) {
  return apiListRecords({ plugin: pluginId, docId, kind, token })
}

export async function createPluginRecord(
  pluginId: string,
  docId: string,
  kind: string,
  data: unknown,
  token?: string,
) {
  return apiPluginsCreateRecord({ plugin: pluginId, docId, kind, requestBody: { data }, token })
}

export async function updatePluginRecord(pluginId: string, id: string, patch: unknown) {
  return apiPluginsUpdateRecord({ plugin: pluginId, id, requestBody: { patch } })
}

export async function deletePluginRecord(pluginId: string, id: string) {
  return apiPluginsDeleteRecord({ plugin: pluginId, id })
}

export async function getPluginKv(
  pluginId: string,
  docId: string,
  key: string,
  token?: string,
) {
  return apiPluginsGetKv({ plugin: pluginId, docId, key, token })
}

export async function putPluginKv(
  pluginId: string,
  docId: string,
  key: string,
  value: unknown,
  token?: string,
) {
  return apiPluginsPutKv({ plugin: pluginId, docId, key, requestBody: { value }, token })
}

export async function installPluginFromUrl(url: string, token?: string) {
  return apiPluginsInstallFromUrl({ requestBody: { url, token } })
}

export async function uninstallPlugin(id: string) {
  return apiPluginsUninstall({ requestBody: { id } })
}
