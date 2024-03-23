const express = require("express")
const app = express()
const Slugs = require("random-word-slugs")
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs')
const Redis = require('ioredis')
const { Server } = require("socket.io");
const http = require('http')
const dotenv = require('dotenv')
const { z } = require('zod')
const { PrismaClient } = require('@prisma/client')
const { Kafka } = require("kafkajs")
const fs = require("fs")
const { createClient } = require("@clickhouse/client")
const { v4: uuid_v4 } = require('uuid')
//Environment Configuration
dotenv.config()
const bodyParser=require("body-parser");

//middlewares uses 

app.use(bodyParser.json())

//Port setup here
const PORT = process.env.PORT || 5000;

//connections and every client setup 

const ESC_CLIENT = new ECSClient({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY,
        secretAccessKey: process.env.AWS_S3_SCECRET_KEY
    }
})


const postGresSqlClient = new PrismaClient({})


// const kafka = new Kafka({
//     clientId: 'logs-container',
//     brokers: ['kafka-1f0e7a39-adarshkdev.a.aivencloud.com:12437'],
//     ssl: {
//         //rejectUnauthorized: false,
//         ca: [fs.readFileSync('kafka.pem', 'utf-8')],
//         // key: fs.readFileSync('/my/custom/client-key.pem', 'utf-8'),
//         // cert: fs.readFileSync('/my/custom/client-cert.pem', 'utf-8')
//     },
//     sasl: {
//         username: "avnadmin",
//         password: "AVNS_8dfrdD27j7mu23VaHw8",
//         mechanism: "plain"
//     }

// })

// const ClickHouseclient = createClient({
//     host: "https://clickhouse-2d29c66d-adarshkdev.a.aivencloud.com:12425",
//     username: "avnadmin",
//     password: "AVNS_kVPIwu-8ln7Q3Jy94VO",
//     database: "default",
// })

const ClickHouseclient = createClient({
    host: "https://izawn0ce3u.ap-southeast-1.aws.clickhouse.cloud:8443",
    //username: "avnadmin",
    password: "~ZS4eGYellM2h",
    database: "default",
})


//const kafkaConsumer = kafka.consumer({ groupId: "api-service-topics" })

const redisURI = "rediss://default:AVNS_aeEILLehWZ1Wk0Ttcju@redis-20394abb-adarshkdev.a.aivencloud.com:12425"
 const REDIS_CLIENT = new Redis(redisURI)

//////////////////////  SOCKET CONNECTION SETUP IN DIFFRENT PORT //////////////

const server = http.createServer()

const io = new Server(server, {
    cors: {
        origin: true
    }
})
//////////////////////////////////////////////////////////////////////////////

io.on('connection', (socket) => {
    console.log('a user connected');



    socket.emit("message", `im here`)

    socket.on("connect", () => {
        console.log("Socket Connected SuccesFully");
    })

    socket.on("close", () => {
        console.log("Socket closed succesfully!!!");
    })


    socket.on('subscribe', (channel) => {
        console.log("Came Here...");
        socket.join(channel)
        socket.emit("message", `JOINED ${channel}`)
    });


});


app.get("/health", (req, res) => {
    return res.status(200).json({ message: "Health is stable" })
})

app.post("/project", async (req, res) => {

    const projectModalSchema = z.object({
        name: z.string(),
        git_url: z.string().url(),
        sub_domain: z.string()
    })

    try {

        const safeParseDataResult = projectModalSchema.parse({ ...req.body, sub_domain: `${req.body.name}-${Slugs.generateSlug()}` })

        // if(safeParseDataResult.error) return res.status(400).json({message:"please Validate Correctly"})

        const { name, git_url, sub_domain } = safeParseDataResult


        const result = await postGresSqlClient.project.create({
            data: {
                name, git_url, sub_domain, custom_domain: `http://${name}-${sub_domain}.localhost:8000/`
            }
        })

        if (result) {
            return res.status(200).json({ message: result })
        }
    } catch (error) {

        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
        }

        return res.status(500).json({ message: "Something Went Wrong" })

    }
})

app.post("/deploy", async (req, res) => {


    const DeploySchema = z.object({
        project_id: z.string(),
    })

    try {

        const safeParseDataResult = DeploySchema.parse(req.body)



        const { project_id } = safeParseDataResult

        //First We need to find the Project with this Id

        const projectExist = await postGresSqlClient.project.findUnique({
            where: { id: project_id }
        })

        if (!projectExist) return res.status(404).json({ error: "Project Not Found" })

        const deployment = await postGresSqlClient.deployment.create({
            data: {
                project: { connect: { id: project_id } },
                status: "QUEUED",
            }
        })




        const { git_url, custom_domain, sub_domain } = projectExist
        const deploymentId = deployment.id
        const Command = new RunTaskCommand({
            cluster: "arn:aws:ecs:ap-south-1:211125722653:cluster/upload-service-server",
            taskDefinition: "arn:aws:ecs:ap-south-1:211125722653:task-definition/upload-server-task:1",
            launchType: "FARGATE",
            count: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: ["subnet-0415fc661923dbcb7", "subnet-0d5c921ac0ee4aa3b", "subnet-0565eca07d69c7241"],
                    securityGroups: ["sg-05436bc88f1484a08"],
                    assignPublicIp: "ENABLED"
                }
            },
            overrides: {
                containerOverrides: [
                    {
                        name: "upload-service-image",
                        environment: [{
                            name: "GIT_URL",
                            value: git_url
                        }, {
                            name: "PROJECT_ID",
                            value: sub_domain
                        },
                        {
                            name: "DEPLOYMENT_ID",
                            value: deploymentId
                        }
                        ]
                    }
                ]
            },
        })
        console.log("STARTED UPLOADING");
        await ESC_CLIENT.send(Command)

        if (deployment) {
            return res.status(200).json({
                message: "Deployment created",
                data: deployment
            })
        }

        // return res.status(200).json({
        //     message: "queued",
        //     status: "queued",
        //     projectSlug,
        //     url: custom_domain,
        // })

    } catch (error) {
        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
            default: {
                console.log(error)
                return res.status(400).json({
                    error: "Wronf", errors: error
                })

            }

        }
    }





})

app.post('/login', async (req, res) => {
    try {
        const userSchema = z.object({
            avatar_url: z.string().url(),
            repos_url: z.string().url(),
            type: z.string(),
            name: z.string(),
            email: z.string().email()
        })

        const parseUserResult = userSchema.parse(req.body)
        //here user not exist we need to create a user 

        let users = await postGresSqlClient.user.findMany({
            where: { email: parseUserResult.email }
        })
        if (users.length) {
            return res.status(200).json({ user: users[0] })
        }
        if (!user.length) {
            let user = await postGresSqlClient.user.create({
                data: {
                    ...parseUserResult,
                    type: "USER"
                }
            })
            return res.status(200).json({ user })
        }



    } catch (error) {
        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
            default: {
                console.log(error)
                return res.status(400).json({
                    error: "Wronf", errors: error
                })

            }

        }
    }
})

// const CONSUMER_Message = () => {
//     REDIS_CLIENT.psubscribe("log:*");
//     console.log("Consumed First");
//     REDIS_CLIENT.on('pmessage', (pattern, channel, message) => {

//         console.log(`Received message '${message}' from channel '${channel}' ${pattern}`);
//         io.to(channel).emit("message", message)
//     });

// }

app.get("/user", async(req, res) => {
    try {
        
        const paramsSchema = z.object({

            email: z.string().email()

        })
        const parsedResult = paramsSchema.parse(req.query)

        let users = await postGresSqlClient.user.findMany({
            where: { email: parsedResult.email }
        })

        if(users.length){
            return res.status(200).json({user:users[0]})
        }


    } catch (error) {
        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
            default: {
                console.log(error)
                return res.status(400).json({
                    error: "Wronf", errors: error
                })

            }

        }
    }
})

async function CONSUMER_Message() {
    try {
        await kafkaConsumer.connect()
        await kafkaConsumer.subscribe({ topics: ["logs-message"] })
        console.log("To The Consumer");
        await kafkaConsumer.run({
            autoCommit: false,
            eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, commitOffsetsIfNecessary }) => {
                console.log("Batch Messages", batch.messages);
                for (let message of batch.messages) {
                    const stringMessage = message.value.toString()
                    const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage)

                    console.log("Project", PROJECT_ID, log);
                    console.log("Parsed Message", JSON.stringify(stringMessage));
                    //we need to add this log to our db 

                    const { query_id } = await ClickHouseclient.insert({
                        table: 'log_events',
                        values: [
                            { event_id: uuid_v4(), deployment_id: DEPLOYMENT_ID, log: log },

                        ],
                        format: 'JSONEachRow',
                    })


                    commitOffsetsIfNecessary(message.offset)
                    resolveOffset(message.offset)
                    await heartbeat()
                }
            },
        })
    } catch (error) {

        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
            case ("KafkaJSProtocolError"): {
                const errors = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Something went wrong is Kafka service", errors
                })
            }
        }

        console.log(error);
    }



}




const REDIS_CONSUMER_MESSAGE=async()=>{
    try {
    
      REDIS_CLIENT.psubscribe("log:*",(err,count)=>{    
        if(err){
            console.log("ERRROR Happened",err);
        }
        console.log("COUNT",count);
      })
      REDIS_CLIENT.on('pmessage', async(pattern, channel, message) => {
        const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(message)
        const { query_id } = await ClickHouseclient.insert({
            table: 'log_events',
            values: [
                { event_id: uuid_v4(), deployment_id: DEPLOYMENT_ID, log: log },

            ],
            format: 'JSONEachRow',
        })

        console.log(`Received message: ${message} from channel ${channel} matching pattern ${pattern}`);
      });
      
    } catch (error) {

        switch (error.name) {
            case ("ZodError"): {
                const errorsArrays = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Validation Failed", errors: errorsArrays.map((errorObj) => {
                        return {
                            path: errorObj.path[0],
                            message: errorObj.message,
                        }
                    })
                })
            }
            case ("KafkaJSProtocolError"): {
                const errors = JSON.parse(error.message)
                return res.status(400).json({
                    error: "Something went wrong is Kafka service", errors
                })
            }
        }

        console.log(error);
    }
}

REDIS_CONSUMER_MESSAGE()


io.listen(9001, () => console.log("Socket Server Runnnning Port 9001"))

app.listen(PORT, () => console.log("API SERVER RUNNING ON PORT 5000"))




