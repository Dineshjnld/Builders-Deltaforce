/*
Copyright 2025 Cognizant Technology Solutions Corp, www.cognizant.com.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import ui from "../components/Operations.module.css"
import {ArrowForward} from "@mui/icons-material"
const topics=[
    {title:"Define a workflow",text:"Write or dictate the problem statement. Include the incoming material, the decision owner, and the deliverable. The intake model proposes a coordinator and specialist assignments.",link:"/",action:"Open intake"},
    {title:"Review and register",text:"Review each specialist’s assignment and the intended outcome. Submit a refinement if needed. Approval registers the design and opens its graph in DeltaSAN.",link:"/",action:"Review a design"},
    {title:"Operate a network",text:"Choose a network from the registry, inspect its topology, and send your input in chat. On smaller screens, switch between Networks, Graph, and Chat.",link:"/multiAgentAccelerator",action:"Open network studio"},
    {title:"Verify an answer",text:"Choose a target network, enter a representative input, and specify text that its final answer should contain. Inspect the result before relying on the workflow.",link:"/harness",action:"Open run harness"}
]
export default function Guide(){return <main className={ui.page}><header className={ui.head}><div className={ui.kicker}>WORKSPACE REFERENCE</div><h1>Operator guide</h1><p>From an initial brief to a tested agent network.</p></header><div className={ui.grid}>{topics.map(t=><section className={ui.card} key={t.title}><div className={ui.pad}><h2>{t.title}</h2><p>{t.text}</p><div className={ui.actions}><a className={ui.button} href={t.link}>{t.action}<ArrowForward fontSize="small"/></a></div></div></section>)}</div></main>}

