import axios, { AxiosInstance } from 'axios';
import type {
  GiteeFileItem,
  GiteeFileContentResponse,
  SongInfo,
  PlaylistInfo,
  AudioFormat,
} from './types';

const GITEE_API_BASE = 'https://gitee.com/api/v5';

/** 支持的音频扩展名集合 */
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.aiff', '.alac',
]);

/** 根据扩展名获取音频格式 */
function getAudioFormat(ext: string): AudioFormat {
  const lower = ext.toLowerCase();
  if (lower === '.mp3') return 'mp3';
  if (lower === '.wav') return 'wav';
  if (lower === '.ogg') return 'ogg';
  if (lower === '.flac') return 'flac';
  if (lower === '.aac') return 'aac';
  if (lower === '.m4a') return 'm4a';
  return 'other';
}

/** 创建带 Token 的 Axios 实例 */
export function createApi(token: string): AxiosInstance {
  return axios.create({
    baseURL: GITEE_API_BASE,
    params: { access_token: token },
    timeout: 30000,
  });
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

/** 获取目录内容列表 */
export async function fetchContents(
  api: AxiosInstance,
  owner: string,
  repo: string,
  path: string = '',
  signal?: AbortSignal
): Promise<GiteeFileItem[]> {
  const url = `/repos/${owner}/${repo}/contents/${path}`;
  const response = await api.get<GiteeFileItem[] | GiteeFileContentResponse>(url, { signal });
  
  if (Array.isArray(response.data)) {
    return response.data;
  }
  // 如果是单个文件（path 指向文件），包装为数组
  return [response.data as unknown as GiteeFileItem];
}

/** 过滤出目录项（歌单） */
export function extractPlaylists(items: GiteeFileItem[]): PlaylistInfo[] {
  return items
    .filter((item) => item.type === 'dir')
    .map((item) => ({ name: item.name, path: item.path }));
}

/**
 * 过滤出音频文件（歌曲），并按文件名倒序排列作为展示顺序。
 *
 * 为什么在这里排序：
 * - Gitee 目录接口返回的是按文件名升序的原始顺序，前端此前直接透传；
 * - 这里按 fileName 降序排一次，展示与播放（播放全部 / 上一首 / 下一首）共用
 *   同一个 songs 数组，因此顺序一并生效；
 * - 只是对已拿到的目录数据重新排序，不会增加任何 Gitee 请求。
 */
export function extractSongs(items: GiteeFileItem[]): SongInfo[] {
  return items
    .filter((item) => {
      if (item.type !== 'file') return false;
      const ext = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
      return AUDIO_EXTENSIONS.has(ext);
    })
    .map((item) => {
      const ext = item.name.substring(item.name.lastIndexOf('.')).toLowerCase();
      const name = item.name.substring(0, item.name.lastIndexOf('.'));
      return {
        key: item.path,
        name,
        fileName: item.name,
        path: item.path,
        size: item.size ?? 0,
        ext,
        format: getAudioFormat(ext),
      };
    })
    .sort((a, b) => (a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0));
}

/** 获取文件 Base64 内容 */
export async function fetchFileBase64(
  api: AxiosInstance,
  owner: string,
  repo: string,
  path: string
): Promise<string> {
  const url = `/repos/${owner}/${repo}/contents/${path}`;
  const response = await api.get<GiteeFileContentResponse>(url);
  return response.data.content;
}
