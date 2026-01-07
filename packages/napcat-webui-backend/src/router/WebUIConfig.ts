import { Router } from 'express';
import {
  GetWebUIConfigHandler,
  GetDisableWebUIHandler,
  UpdateDisableWebUIHandler,
  GetDisableNonLANAccessHandler,
  UpdateDisableNonLANAccessHandler,
  UpdateWebUIConfigHandler,
  GetMsgDbEnableHandler,
  UpdateMsgDbEnableHandler,
} from '@/napcat-webui-backend/src/api/WebUIConfig';

const router = Router();

// 获取WebUI基础配置
router.get('/GetConfig', GetWebUIConfigHandler);

// 更新WebUI基础配置
router.post('/UpdateConfig', UpdateWebUIConfigHandler);

// 获取是否禁用WebUI
router.get('/GetDisableWebUI', GetDisableWebUIHandler);

// 更新是否禁用WebUI
router.post('/UpdateDisableWebUI', UpdateDisableWebUIHandler);

// 获取是否禁用非局域网访问
router.get('/GetDisableNonLANAccess', GetDisableNonLANAccessHandler);

// 更新是否禁用非局域网访问
router.post('/UpdateDisableNonLANAccess', UpdateDisableNonLANAccessHandler);

// 获取消息数据库开关
router.get('/GetMsgDbEnable', GetMsgDbEnableHandler);
// 更新消息数据库开关（同步napcat.json）
router.post('/UpdateMsgDbEnable', UpdateMsgDbEnableHandler);

export { router as WebUIConfigRouter };
