import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Release signing comes from CI secrets (see .github/workflows/android.yml); other builds use the debug key.
val keystoreFile: String? = System.getenv("KEYSTORE_FILE")
val runNumber: Int = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
// Built from this repo since 2026-10-23 (boni-android.yml): the first Boni's repo published up to versionCode 17
// (0.1.17), so the code starts above it and a phone that has that one takes this one as an update.
val versionBase = 100

android {
    namespace = "io.github.juanbonastre.boni"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.juanbonastre.boni"
        minSdk = 29
        targetSdk = 35
        versionCode = versionBase + runNumber
        versionName = "0.2.$runNumber"
    }

    signingConfigs {
        create("release") {
            if (keystoreFile != null) {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig =
                if (keystoreFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.work)
    testImplementation(libs.junit)
    testImplementation(libs.json)
}
