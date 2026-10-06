package com.tekserp.lantls

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** Expo otomatik bağlama bu paketi bulur; fabrika Application.onCreate'te, React örneğinden önce kurulur. */
class TeksErpLanTlsPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        LanTls.install(application)
      }
    })
}
