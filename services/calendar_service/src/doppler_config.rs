#![allow(unused)]
#![recursion_limit = "256"]

use macro_env::Environment;

const DOPPLER_PROJECT: &str = "calendar-service";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dev = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Develop.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    dev.load::<calendar_service::config::Config>().await?;

    let prd = doppler_config::DopplerConfig::builder()
        .token_from_env("DOPPLER_TOKEN")
        .config(Environment::Production.to_doppler_slug())
        .project(DOPPLER_PROJECT)
        .build()
        .expect("able to grab doppler project");

    prd.load::<calendar_service::config::Config>().await?;

    Ok(())
}
