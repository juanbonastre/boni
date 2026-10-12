import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation(libs.coroutines.swing)
    implementation(libs.ktor.client.cio)
    testImplementation(kotlin("test"))
}

compose.desktop {
    application {
        mainClass = "io.github.juanbonastre.boni.desktop.MainKt"
        nativeDistributions {
            // Dmg and Msi later (they also require a version >= 1.0.0); tested on Linux only for now.
            targetFormats(TargetFormat.Deb)
            packageName = "boni"
            packageVersion = (findProperty("boniVersion") as String?) ?: "0.1.0"
            description = "Boni: graficas y capturas"
            vendor = "Juan Bonastre"
            modules("java.net.http", "jdk.unsupported")
            linux {
                shortcut = true
                menuGroup = "Office"
            }
        }
    }
}

// Renders charts and widgets with sample data to PNG (light and dark), without a display: used by CI to review the look.
tasks.register<JavaExec>("screenshots") {
    group = "verification"
    description = "Render PNG screenshots of charts and widgets into build/screenshots"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("io.github.juanbonastre.boni.desktop.screenshots.ScreenshotsKt")
    args(layout.buildDirectory.dir("screenshots").get().asFile.absolutePath)
    systemProperty("java.awt.headless", "true")
}
