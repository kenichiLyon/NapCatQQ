import { RequestHandler } from 'express';
import { WebUiConfig } from '@/napcat-webui-backend/index';
import { sendError, sendSuccess } from '@/napcat-webui-backend/src/utils/response';
import { isEmpty } from '@/napcat-webui-backend/src/utils/check';

// 获取WebUI基础配置
export const GetWebUIConfigHandler: RequestHandler = async (_, res) => {
  try {
    const config = await WebUiConfig.GetWebUIConfig();
    return sendSuccess(res, {
      host: config.host,
      port: config.port,
      loginRate: config.loginRate,
      disableWebUI: config.disableWebUI,
      disableNonLANAccess: config.disableNonLANAccess,
      msgDbEnable: (config as any).msgDbEnable ?? true,
      dbType: (config as any).dbType ?? 'mysql',
    });
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `获取WebUI配置失败: ${msg}`);
  }
};

// 获取是否禁用WebUI
export const GetDisableWebUIHandler: RequestHandler = async (_, res) => {
  try {
    const disable = await WebUiConfig.GetDisableWebUI();
    return sendSuccess(res, disable);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `获取WebUI禁用状态失败: ${msg}`);
  }
};

// 更新是否禁用WebUI
export const UpdateDisableWebUIHandler: RequestHandler = async (req, res) => {
  try {
    const { disable } = req.body;

    if (typeof disable !== 'boolean') {
      return sendError(res, 'disable参数必须是布尔值');
    }

    await WebUiConfig.UpdateDisableWebUI(disable);
    return sendSuccess(res, null);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `更新WebUI禁用状态失败: ${msg}`);
  }
};

// 获取是否禁用非局域网访问
export const GetDisableNonLANAccessHandler: RequestHandler = async (_, res) => {
  try {
    const disable = await WebUiConfig.GetDisableNonLANAccess();
    return sendSuccess(res, disable);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `获取非局域网访问禁用状态失败: ${msg}`);
  }
};

// 更新是否禁用非局域网访问
export const UpdateDisableNonLANAccessHandler: RequestHandler = async (req, res) => {
  try {
    const { disable } = req.body;

    if (typeof disable !== 'boolean') {
      return sendError(res, 'disable参数必须是布尔值');
    }

    await WebUiConfig.UpdateDisableNonLANAccess(disable);
    return sendSuccess(res, null);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `更新非局域网访问禁用状态失败: ${msg}`);
  }
};

// 更新WebUI基础配置
export const UpdateWebUIConfigHandler: RequestHandler = async (req, res) => {
  try {
    const { host, port, loginRate, disableWebUI, disableNonLANAccess } = req.body;

    const updateConfig: any = {};

    if (host !== undefined) {
      if (isEmpty(host)) {
        return sendError(res, 'host不能为空');
      }
      updateConfig.host = host;
    }

    if (port !== undefined) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return sendError(res, 'port必须是1-65535之间的整数');
      }
      updateConfig.port = port;
    }

    if (loginRate !== undefined) {
      if (!Number.isInteger(loginRate) || loginRate < 1) {
        return sendError(res, 'loginRate必须是大于0的整数');
      }
      updateConfig.loginRate = loginRate;
    }

    if (disableWebUI !== undefined) {
      if (typeof disableWebUI !== 'boolean') {
        return sendError(res, 'disableWebUI必须是布尔值');
      }
      updateConfig.disableWebUI = disableWebUI;
    }

    if (disableNonLANAccess !== undefined) {
      if (typeof disableNonLANAccess !== 'boolean') {
        return sendError(res, 'disableNonLANAccess必须是布尔值');
      }
      updateConfig.disableNonLANAccess = disableNonLANAccess;
    }

    if (req.body.msgDbEnable !== undefined) {
      if (typeof req.body.msgDbEnable !== 'boolean') {
        return sendError(res, 'msgDbEnable必须是布尔值');
      }
      updateConfig.msgDbEnable = req.body.msgDbEnable;
    }

    if (req.body.dbType !== undefined) {
      const allowed = ['mysql', 'postgres', 'sqljs'];
      if (!allowed.includes(req.body.dbType)) {
        return sendError(res, 'dbType必须是 mysql/postgres/sqljs 之一');
      }
      updateConfig.dbType = req.body.dbType;
    }

    await WebUiConfig.UpdateWebUIConfig(updateConfig);
    // 同步到 napcat.json
    const cfgDir = webUiPathWrapper.configPath;
    const files = await fs.readdir(cfgDir);
    const targets = files.filter(f => f.startsWith('napcat') && f.endsWith('.json')).map(f => path.join(cfgDir, f));
    for (const file of targets) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const json = JSON.parse(content);
        if (updateConfig.msgDbEnable !== undefined) {
          json.db = json.db || {};
          json.db.enable = updateConfig.msgDbEnable;
        }
        if (updateConfig.dbType !== undefined) {
          json.db = json.db || {};
          json.db.type = updateConfig.dbType;
        }
        await fs.writeFile(file, JSON.stringify(json, null, 2), 'utf-8');
      } catch {}
    }
    return sendSuccess(res, null);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `更新WebUI配置失败: ${msg}`);
  }
};

// 获取消息数据库开关
export const GetMsgDbEnableHandler: RequestHandler = async (_, res) => {
  try {
    const config = await WebUiConfig.GetWebUIConfig();
    return sendSuccess(res, (config as any).msgDbEnable ?? true);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `获取消息数据库开关失败: ${msg}`);
  }
};

// 更新消息数据库开关并同步到 napcat.json
import { webUiPathWrapper } from '@/napcat-webui-backend/index';
import fs from 'node:fs/promises';
import path from 'node:path';

export const UpdateMsgDbEnableHandler: RequestHandler = async (req, res) => {
  try {
    const { enable } = req.body;
    if (typeof enable !== 'boolean') {
      return sendError(res, 'enable必须是布尔值');
    }
    await WebUiConfig.UpdateWebUIConfig({ msgDbEnable: enable });
    const cfgDir = webUiPathWrapper.configPath;
    const files = await fs.readdir(cfgDir);
    const targets = files.filter(f => f.startsWith('napcat') && f.endsWith('.json')).map(f => path.join(cfgDir, f));
    for (const file of targets) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const json = JSON.parse(content);
        json.db = json.db || {};
        json.db.enable = enable;
        await fs.writeFile(file, JSON.stringify(json, null, 2), 'utf-8');
      } catch {}
    }
    return sendSuccess(res, true);
  } catch (error) {
    const msg = (error as Error).message;
    return sendError(res, `更新消息数据库开关失败: ${msg}`);
  }
};
