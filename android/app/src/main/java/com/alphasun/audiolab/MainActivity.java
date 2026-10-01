package com.alphasun.audiolab;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

/**
 * AlphaSun 声波分析仪 · Android 入口
 *
 * 【v2.2.0 修复记录 — APK 无法采集声音的根因】
 * 1. 原实现在 onCreate 中调用 webView.setWebChromeClient(new BridgeWebChromeClient(bridge){...})
 *    覆写了 Capacitor 自身的 WebChromeClient，破坏了 Capacitor 的完整权限回调链
 *    （原生 BridgeWebChromeClient.onPermissionRequest 会检查并申请 RECORD_AUDIO +
 *      MODIFY_AUDIO_SETTINGS，授权通过后才 request.grant；覆写版无条件 grant，
 *      丢掉了与系统权限申请的所有关联，且构造函数内的 registerForActivityResult
 *      在 onCreate 时机注册会抛 IllegalStateException）。
 * 2. Manifest 缺少 android.permission.MODIFY_AUDIO_SETTINGS，导致音频采集链路不完整。
 *
 * 【修复】删除全部 WebChromeClient 覆写，完全依赖 Capacitor 原生实现；
 *        权限仅在首次启动做一次主动申请（提升体验），实际授权由 Capacitor 原生链路在
 *        getUserMedia 触发时完成。
 */
public class MainActivity extends BridgeActivity {
  private static final int REQ_RECORD_AUDIO = 1001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // 首次启动主动申请麦克风权限（可选优化，仅为减少首次采集时的等待）
    // 注意：不覆写 WebChromeClient —— Capacitor 原生 BridgeWebChromeClient 已完整处理
    // WebView 的 AUDIO_CAPTURE 权限请求（含 RECORD_AUDIO / MODIFY_AUDIO_SETTINGS 检查与申请）。
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    // BridgeActivity 内部会处理 Capacitor 的权限请求回调，此处无需额外逻辑。
    // 保留覆写是为了显式声明「本 Activity 不拦截权限结果」，便于后续维护者理解。
  }
}
